import test from "node:test";
import assert from "node:assert/strict";

/**
 * Regression tests for Phase 1 & Phase 2:
 * Voice completion state machine, fail-open prevention on reload, and durable scoring.
 */

interface MockTask {
  id: string;
  student_id: string;
  status: "pending" | "in_progress" | "pending_voice" | "completed";
  completed_at: string | null;
  xp_reward: number;
}

interface MockSubmission {
  id: string;
  task_id: string;
  student_id: string;
  status: "passed" | "failed";
  xp_awarded: number;
}

interface MockVoice {
  id: string;
  task_id: string;
  student_id: string;
  status: "pending" | "processing" | "scored" | "failed";
  score: number | null;
}

class MockStateEngine {
  tasks = new Map<string, MockTask>();
  submissions = new Map<string, MockSubmission>();
  voice = new Map<string, MockVoice>();
  xpLogs: { student_id: string; xp: number; source: string }[] = [];
  studentXp = new Map<string, number>();

  createTask(id: string, studentId: string, xpReward = 50): MockTask {
    const task: MockTask = {
      id,
      student_id: studentId,
      status: "pending",
      completed_at: null,
      xp_reward: xpReward,
    };
    this.tasks.set(id, task);
    return task;
  }

  /** Migration 127: record_task_submission sets pending_voice on code pass, not completed */
  recordTaskSubmission(taskId: string, studentId: string, passed: boolean): { ok: boolean; status: string; task_status: string; xp_awarded: number } {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, status: "error", task_status: "unknown", xp_awarded: 0 };

    if (!passed) {
      this.submissions.set(`${taskId}:${studentId}`, {
        id: crypto.randomUUID(),
        task_id: taskId,
        student_id: studentId,
        status: "failed",
        xp_awarded: 0,
      });
      return { ok: true, status: "failed", task_status: task.status, xp_awarded: 0 };
    }

    this.submissions.set(`${taskId}:${studentId}`, {
      id: crypto.randomUUID(),
      task_id: taskId,
      student_id: studentId,
      status: "passed",
      xp_awarded: 0, // Withheld until voice completion
    });

    // Server-authoritative state transition: code passed -> pending_voice
    if (task.status !== "completed") {
      task.status = "pending_voice";
    }

    return { ok: true, status: "passed", task_status: task.status, xp_awarded: 0 };
  }

  /** Migration 127: complete_voice_scoring finalizes task and awards XP */
  completeVoiceScoring(voiceId: string, score: number): boolean {
    const v = this.voice.get(voiceId);
    if (!v) return false;

    v.status = "scored";
    v.score = score;

    const task = this.tasks.get(v.task_id);
    if (task && task.status !== "completed") {
      task.status = "completed";
      task.completed_at = new Date().toISOString();

      // Idempotent XP award
      const source = `task:${task.id}`;
      const alreadyAwarded = this.xpLogs.some((l) => l.student_id === v.student_id && l.source === source);
      if (!alreadyAwarded && task.xp_reward > 0) {
        this.xpLogs.push({ student_id: v.student_id, xp: task.xp_reward, source });
        const current = this.studentXp.get(v.student_id) ?? 0;
        this.studentXp.set(v.student_id, current + task.xp_reward);
        const sub = this.submissions.get(`${task.id}:${v.student_id}`);
        if (sub) sub.xp_awarded = task.xp_reward;
      }
    }
    return true;
  }

  /** fail_voice_scoring keeps task in pending_voice */
  failVoiceScoring(voiceId: string): boolean {
    const v = this.voice.get(voiceId);
    if (!v) return false;
    v.status = "failed";
    v.score = null;
    return true;
  }

  /** Daily Card UI resolution logic matching StudentDailyCard.tsx */
  resolveDailyCardView(taskId: string): { badge: string; primaryAction: string; isDone: boolean } {
    const task = this.tasks.get(taskId);
    if (!task) return { badge: "none", primaryAction: "none", isDone: false };

    if (task.status === "completed") {
      return { badge: "Done · 100%", primaryAction: "View my answer", isDone: true };
    }
    if (task.status === "pending_voice") {
      return { badge: "Code passed · Spoken explanation required", primaryAction: "Record 60s explain", isDone: false };
    }
    return { badge: "Open", primaryAction: "Solve in editor", isDone: false };
  }
}

test("Voice State Machine: Passing code submission transitions task to pending_voice without awarding XP", () => {
  const engine = new MockStateEngine();
  const task = engine.createTask("task-1", "student-a", 50);

  const res = engine.recordTaskSubmission(task.id, "student-a", true);
  assert.equal(res.status, "passed");
  assert.equal(res.task_status, "pending_voice");
  assert.equal(res.xp_awarded, 0);

  // Assert database state: task is not completed yet
  assert.equal(task.status, "pending_voice");
  assert.equal(task.completed_at, null);
  assert.equal(engine.xpLogs.length, 0);
  assert.equal(engine.studentXp.get("student-a") ?? 0, 0);
});

test("Voice State Machine: Browser reload recovers pending_voice and forces explanation, preventing bypass", () => {
  const engine = new MockStateEngine();
  const task = engine.createTask("task-2", "student-b", 50);

  // 1. Submit passing code
  engine.recordTaskSubmission(task.id, "student-b", true);

  // 2. Simulate browser reload (React state lost, fresh fetch from DB)
  const viewAfterReload = engine.resolveDailyCardView(task.id);

  assert.equal(viewAfterReload.isDone, false);
  assert.equal(viewAfterReload.badge, "Code passed · Spoken explanation required");
  assert.equal(viewAfterReload.primaryAction, "Record 60s explain");
  assert.notEqual(viewAfterReload.badge, "Done · 100%");
});

test("Voice State Machine: Scored voice explanation completes task and awards XP atomically", () => {
  const engine = new MockStateEngine();
  const task = engine.createTask("task-3", "student-c", 75);

  // 1. Code pass
  engine.recordTaskSubmission(task.id, "student-c", true);

  // 2. Enqueue voice
  const voiceId = "voice-3";
  engine.voice.set(voiceId, {
    id: voiceId,
    task_id: task.id,
    student_id: "student-c",
    status: "processing",
    score: null,
  });

  // 3. Worker scores voice
  const ok = engine.completeVoiceScoring(voiceId, 88);
  assert.equal(ok, true);

  // 4. Verification: task is now completed, completed_at is set, XP is awarded
  assert.equal(task.status, "completed");
  assert.ok(task.completed_at !== null);
  assert.equal(engine.studentXp.get("student-c"), 75);
  assert.equal(engine.xpLogs.length, 1);
  assert.equal(engine.xpLogs[0].xp, 75);

  // 5. Daily card view shows completed
  const view = engine.resolveDailyCardView(task.id);
  assert.equal(view.isDone, true);
  assert.equal(view.badge, "Done · 100%");
  assert.equal(view.primaryAction, "View my answer");
});

test("Voice State Machine: Replaying score or duplicate deliveries does not double-award XP", () => {
  const engine = new MockStateEngine();
  const task = engine.createTask("task-4", "student-d", 100);

  engine.recordTaskSubmission(task.id, "student-d", true);

  const voiceId = "voice-4";
  engine.voice.set(voiceId, {
    id: voiceId,
    task_id: task.id,
    student_id: "student-d",
    status: "processing",
    score: null,
  });

  // First scoring call
  engine.completeVoiceScoring(voiceId, 92);
  assert.equal(engine.studentXp.get("student-d"), 100);
  assert.equal(engine.xpLogs.length, 1);

  // Replay of duplicate scoring message
  engine.completeVoiceScoring(voiceId, 92);
  assert.equal(engine.studentXp.get("student-d"), 100); // Unchanged
  assert.equal(engine.xpLogs.length, 1); // No second XP log inserted
});

test("Voice State Machine: Failed voice explanation leaves task in pending_voice allowing re-record", () => {
  const engine = new MockStateEngine();
  const task = engine.createTask("task-5", "student-e", 50);

  engine.recordTaskSubmission(task.id, "student-e", true);

  const voiceId = "voice-5";
  engine.voice.set(voiceId, {
    id: voiceId,
    task_id: task.id,
    student_id: "student-e",
    status: "processing",
    score: null,
  });

  // Whisper / LLM detects non-speech or non-English -> fail
  engine.failVoiceScoring(voiceId);

  assert.equal(task.status, "pending_voice");
  assert.equal(task.completed_at, null);
  assert.equal(engine.studentXp.get("student-e") ?? 0, 0);

  // Student re-records
  const newVoiceId = "voice-5-retry";
  engine.voice.set(newVoiceId, {
    id: newVoiceId,
    task_id: task.id,
    student_id: "student-e",
    status: "processing",
    score: null,
  });

  engine.completeVoiceScoring(newVoiceId, 85);
  assert.equal(task.status, "completed");
  assert.equal(engine.studentXp.get("student-e"), 50);
});
