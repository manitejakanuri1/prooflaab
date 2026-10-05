import { useState } from "react";
import { Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Candidate, ProofItem } from "@/recruiter/types";

/**
 * The Proof Profile, as delivered — screens built against mock data, now fed
 * from the database through src/recruiter/data.ts.
 *
 * The rule it exists for: every score is a button that opens the evidence
 * underneath it. A recruiter can always get from a number to the work.
 */

function Avatar({ initials, color }: { initials: string; color: string }) {
  return <div className='flex h-10 w-10 items-center justify-center rounded-full border font-mono text-xs font-semibold' style={{ backgroundColor: `${color}20`, borderColor: `${color}40`, color }}>{initials}</div>
}

function ScorePill({ label, score, proof, verified }: { label: string; score: number | null; proof: ProofItem[]; verified?: boolean }) {
  const [open, setOpen] = useState(false)
  const tone = score == null ? 'text-muted-foreground' : score >= 85 ? 'text-emerald-400' : score >= 75 ? 'text-amber-400' : 'text-zinc-300'
  return (
    <div>
      <button onClick={() => setOpen(v => !v)} className='rounded-lg border border-border bg-secondary/70 px-2.5 py-1 text-left text-xs font-mono hover:border-primary/50'>
        <span className='text-muted-foreground'>{label} </span><span className={tone}>{score ?? 'not tested'}</span>{verified ? <span className='ml-1 text-primary'>•</span> : null}
      </button>
      {open && (
        <div className='mt-2 rounded-lg border border-border bg-secondary/40 p-3 animate-slide-down'>
          <div className='mb-2 flex items-center justify-between'><span className='section-label'>proof · {label}</span><span className='text-xs font-mono tabular text-primary'>{score}</span></div>
          <div className='space-y-2'>
            {proof.map((item, i) => (
              <div key={i} className='rounded-lg border border-border bg-card/80 p-3'>
                <div className='flex items-center justify-between gap-2'><div className='text-xs font-medium'>{item.title}</div><div className='text-[11px] font-mono tabular text-muted-foreground'>{item.score ?? '—'}</div></div>
                <p className='mt-1 text-xs text-muted-foreground'>{item.detail}</p>
                <div className='mt-2 flex gap-2 text-[10px] font-mono uppercase tracking-wide text-muted-foreground'><span>{item.type}</span><span>{item.date}</span>{item.url ? <span className='truncate text-primary/80'>{item.url}</span> : null}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProofProfile({ candidate }: { candidate: Candidate }) {
  return (
    <div className='grid gap-4 lg:grid-cols-[1.2fr_0.8fr]'>
      <div className='space-y-4'>
        <Card className='metric-card'>
          <CardHeader>
            <div className='flex items-start justify-between gap-4'>
              <div className='flex gap-3'>
                <Avatar initials={candidate.initials} color={candidate.avatarColor} />
                <div>
                  <div className='section-label'>proof profile</div>
                  <CardTitle className='mt-1 text-xl'>{candidate.name}</CardTitle>
                  <div className='mt-1 text-sm text-muted-foreground'>{candidate.branch} · {candidate.education}</div>
                  <div className='mt-3 flex flex-wrap gap-2'>{candidate.roleFit.map(role => <Badge key={role} variant='outline'>{role}</Badge>)}</div>
                </div>
              </div>
              <div className='grid gap-2 text-right text-xs font-mono tabular'>
                <div><span className='section-label'>streak</span><div className='mt-1 text-lg'>{candidate.streak}</div></div>
                <div><span className='section-label'>last active</span><div className='mt-1'>{candidate.lastActive}</div></div>
              </div>
            </div>
          </CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            <div>
              <div className='section-label mb-2'>verified and assessed skills</div>
              <div className='space-y-2'>
                {candidate.skills.map(skill => (
                  <div key={skill.name} className='rounded-lg border border-border bg-secondary/30 p-3'>
                    <div className='mb-2 flex items-center justify-between'><span className='text-sm font-medium'>{skill.name}</span><span className='text-[11px] font-mono text-muted-foreground'>{skill.assessments} assessments</span></div>
                    <ScorePill label={skill.name} score={skill.score} proof={skill.proof} verified={skill.verified} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className='section-label mb-2'>assessment scores</div>
              <div className='space-y-2'>
                {candidate.assessmentScores.map(score => (
                  <div key={score.category} className='rounded-lg border border-border bg-secondary/30 p-3'>
                    <div className='mb-2 flex items-center justify-between'><span className='text-sm font-medium'>{score.category}</span><span className='text-xs font-mono tabular'>{score.score}</span></div>
                    <Progress value={score.score} />
                    <div className='mt-2'><ScorePill label={score.category} score={score.score} proof={score.proof} /></div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className='metric-card'>
          <CardHeader><CardTitle>Projects · certifications</CardTitle></CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-3'>
              <div className='section-label'>projects</div>
              {candidate.projects.map(project => (
                <div key={project.name} className='rounded-lg border border-border bg-secondary/30 p-3'>
                  <div className='flex items-center justify-between'><div className='text-sm font-medium'>{project.name}</div><div className='text-xs font-mono tabular text-muted-foreground'>{project.stars}★</div></div>
                  <p className='mt-1 text-xs text-muted-foreground'>{project.description}</p>
                  <div className='mt-2 flex flex-wrap gap-1'>{project.tech.map(t => <Badge key={t} variant='secondary'>{t}</Badge>)}</div>
                </div>
              ))}
            </div>
            <div className='space-y-3'>
              <div className='section-label'>certifications</div>
              {candidate.certifications.map(cert => (
                <div key={cert.name} className='rounded-lg border border-border bg-secondary/30 p-3'>
                  <div className='text-sm font-medium'>{cert.name}</div>
                  <div className='mt-1 text-xs text-muted-foreground'>{cert.issuer} · {cert.date}</div>
                  <div className='mt-2'>{cert.verified ? <Badge variant='default'>verified</Badge> : <Badge variant='outline'>unverified</Badge>}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className='metric-card'>
          <CardHeader><CardTitle>Daily task history · voice explanations</CardTitle></CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <div className='section-label'>daily task history</div>
              {candidate.dailyTasks.map((task, i) => (
                <div key={i} className='flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2'>
                  <div>
                    <div className='text-sm'>{task.task}</div>
                    <div className='text-[11px] text-muted-foreground'>{task.date}</div>
                  </div>
                  <div className='text-right text-xs font-mono'>
                    <div className={task.status === 'completed' ? 'text-emerald-400' : task.status === 'pending' ? 'text-amber-400' : 'text-zinc-500'}>{task.status}</div>
                    <div className='tabular text-muted-foreground'>{task.score ?? '—'}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className='space-y-2'>
              <div className='section-label'>60-second voice explanations</div>
              {candidate.voiceExplanations.map(voice => (
                <div key={voice.id} className='rounded-lg border border-border bg-secondary/30 p-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <div className='flex items-center gap-3'><button className='flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary'><Play className='h-4 w-4 fill-current' /></button><div><div className='text-sm font-medium'>{voice.topic}</div><div className='text-[11px] text-muted-foreground'>{voice.date}</div></div></div>
                    <div className='text-xs font-mono tabular text-muted-foreground'>{voice.duration}</div>
                  </div>
                  <p className='mt-3 text-xs text-muted-foreground'>{voice.transcript}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className='space-y-4'>
        <Card className='metric-card'>
          <CardHeader><CardTitle>Consistency · activity · rank</CardTitle></CardHeader>
          <CardContent className='space-y-4'>
            <div className='rounded-lg border border-border bg-secondary/30 p-3'><div className='section-label'>consistency</div><div className='mt-2 flex items-center justify-between'><div className='text-2xl font-semibold tabular'>{candidate.consistency}</div><div className='text-xs text-muted-foreground'>{candidate.lastActive}</div></div><div className='mt-2'><Progress value={candidate.consistency} /></div></div>
            <div className='rounded-lg border border-border bg-secondary/30 p-3'><div className='section-label'>communication score</div><div className='mt-2'><ScorePill label='Communication' score={candidate.communicationScore} proof={candidate.assessmentScores.find(a => a.category === 'Communication')?.proof ?? []} /></div></div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='rounded-lg border border-border bg-secondary/30 p-3'><div className='section-label'>squad rank</div><div className='mt-2 text-xl font-semibold tabular'>{candidate.squad.rank}/{candidate.squad.totalMembers}</div><div className='mt-1 text-xs text-muted-foreground'>{candidate.squad.squadName}</div></div>
              <div className='rounded-lg border border-border bg-secondary/30 p-3'><div className='section-label'>season rank</div><div className='mt-2 text-xl font-semibold tabular'>#{candidate.seasonRank}</div><div className='mt-1 text-xs text-muted-foreground'>{candidate.squad.seasonPoints} pts</div></div>
            </div>
            <div className='rounded-lg border border-border bg-secondary/30 p-3'><div className='section-label'>squad record</div><div className='mt-2 flex items-center justify-between text-sm'><span>Wins</span><span className='font-mono tabular'>{candidate.squad.wins}</span></div><div className='mt-1 flex items-center justify-between text-sm'><span>Losses</span><span className='font-mono tabular'>{candidate.squad.losses}</span></div></div>
          </CardContent>
        </Card>

        <Card className='metric-card'>
          <CardHeader><CardTitle>Sponsored task history</CardTitle></CardHeader>
          <CardContent className='space-y-3'>
            {candidate.sponsoredTasks.length ? candidate.sponsoredTasks.map(task => (
              <div key={task.id} className='rounded-lg border border-border bg-secondary/30 p-3'>
                <div className='flex items-center justify-between gap-2'><div className='text-sm font-medium'>{task.title}</div><Badge variant={task.status === 'reviewed' ? 'default' : 'secondary'}>{task.status}</Badge></div>
                <p className='mt-1 text-xs text-muted-foreground'>{task.description}</p>
                <div className='mt-2 text-[11px] text-muted-foreground'>Created {task.createdDate} · deadline {task.deadline}</div>
                {task.outcome ? <div className='mt-2'><Badge variant='outline'>{task.outcome.replace('_', ' ')}</Badge></div> : null}
                {task.reviewNotes ? <p className='mt-2 text-xs text-muted-foreground'>{task.reviewNotes}</p> : null}
              </div>
            )) : <div className='rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground'>No sponsored tasks yet.</div>}
          </CardContent>
        </Card>

        <Card className='metric-card'>
          <CardHeader><CardTitle>Recommended role fit</CardTitle></CardHeader>
          <CardContent className='flex flex-wrap gap-2'>{candidate.roleFit.map(role => <Badge key={role}>{role}</Badge>)}</CardContent>
        </Card>
      </div>
    </div>
  )
}

export { Avatar, ScorePill };
export default ProofProfile;
