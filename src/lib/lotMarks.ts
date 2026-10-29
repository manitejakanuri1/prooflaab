import { supabase } from "@/integrations/supabase/client";
import type { LotState, WeekMarks } from "./lotMarksText";

export * from "./lotMarksText";

export async function loadLotState(taskId: string): Promise<LotState | null> {
  const { data, error } = await supabase.rpc("my_lot_state" as never, { _task_id: taskId } as never);
  return error ? null : (data as unknown as LotState | null);
}

export async function submitLot(taskId: string): Promise<LotState | null> {
  const { data, error } = await supabase.rpc("submit_my_lot" as never, { _task_id: taskId } as never);
  return error ? null : (data as unknown as LotState | null);
}

export async function loadWeekMarks(): Promise<WeekMarks | null> {
  const { data, error } = await supabase.rpc("my_marks_week" as never);
  return error ? null : (data as unknown as WeekMarks | null);
}
