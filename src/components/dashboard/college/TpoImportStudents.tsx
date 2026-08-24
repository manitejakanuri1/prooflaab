import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download } from "lucide-react";

/** One parsed line, before anything has been created. */
interface ParsedRow {
  row_number: number;
  name: string;
  email: string;
  phone: string;
  roll_number: string;
  branch: string;
  batch: string;
  validation_status: "valid" | "invalid" | "duplicate";
  error_message: string | null;
  raw: Record<string, string>;
}

interface Props {
  collegeId: string | null;
  onImported?: () => void;
}

/**
 * Importing a batch of students.
 *
 * The specification makes this six steps, and the middle three are the ones
 * that matter: validate, preview, and hand the bad rows back. An importer that
 * silently drops four of seventy rows is worse than one that refuses, because
 * nobody finds out until a student asks why they never got an invitation.
 *
 * The job itself is recorded in student_imports with a row per line, so "70
 * rows, 66 valid, 2 duplicates, 2 missing emails" survives the page being
 * closed and the error report can be downloaded afterwards.
 */
const TpoImportStudents = ({ collegeId, onImported }: Props) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Splits one CSV line, honouring quoted fields that contain commas. */
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const parse = async (file: File) => {
    setBusy(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length < 2) throw new Error("The file has a header but no rows.");

      const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z_]/g, "_"));
      const idx = (...names: string[]) => {
        for (const n of names) { const i = headers.indexOf(n); if (i !== -1) return i; }
        return -1;
      };
      const iName  = idx("name", "full_name", "student_name");
      const iMail  = idx("email", "email_address", "mail");
      const iRoll  = idx("roll_number", "roll_no", "rollno", "roll");
      const iBranch= idx("branch", "department", "dept");
      const iBatch = idx("batch", "year", "year_of_study", "graduation_year");
      // §6 lists phone as required. It was read by nothing and had nowhere to
      // land, which is also why WhatsApp could never be switched on.
      const iPhone = idx("phone", "phone_number", "mobile", "mobile_number", "contact");

      if (iName === -1 || iMail === -1) {
        throw new Error("The file needs at least a 'name' and an 'email' column.");
      }

      // Emails already on the platform, so a re-upload of the same list reports
      // duplicates rather than failing halfway through creating them.
      const { data: existing } = await supabase
        .from("student_contact").select("email");
      const known = new Set((existing ?? []).map((r) => (r.email ?? "").toLowerCase()));
      const seen = new Set<string>();

      const parsed: ParsedRow[] = lines.slice(1).map((line, i) => {
        const cells = splitLine(line);
        const raw = Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ""]));
        const name = cells[iName] ?? "";
        const email = (cells[iMail] ?? "").toLowerCase();
        const roll = iRoll === -1 ? "" : cells[iRoll] ?? "";
        // Kept as the ten digits and nothing else, so two spellings of the
        // same number are one number.
        const phoneRaw = iPhone === -1 ? "" : (cells[iPhone] ?? "");
        const phoneDigits = phoneRaw.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
        const phone = phoneDigits.length === 10 ? phoneDigits : "";

        let status: ParsedRow["validation_status"] = "valid";
        let err: string | null = null;

        if (!name) { status = "invalid"; err = "Name is missing"; }
        else if (!email) { status = "invalid"; err = "Email is missing"; }
        else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { status = "invalid"; err = "Email is not a valid address"; }
        else if (known.has(email)) { status = "duplicate"; err = "Already on the platform"; }
        else if (seen.has(email)) { status = "duplicate"; err = "Repeated earlier in this file"; }

        // A malformed number is worth saying out loud, but a student is not
        // worth rejecting over it: the email is what the invitation needs.
        if (status === "valid" && phoneRaw && !phone) {
          err = `Phone "${phoneRaw.trim()}" is not 10 digits — imported without it`;
        }

        if (status === "valid") seen.add(email);

        return {
          row_number: i + 2, name, email, phone, roll_number: roll,
          branch: iBranch === -1 ? "" : cells[iBranch] ?? "",
          batch:  iBatch  === -1 ? "" : cells[iBatch]  ?? "",
          validation_status: status, error_message: err, raw,
        };
      });

      const counts = tally(parsed);

      // The job is written before anything is created, so a preview that is
      // never committed still leaves a record that somebody tried.
      const { data: job, error: jobErr } = await supabase
        .from("student_imports")
        .insert({
          college_id: collegeId!,
          uploaded_by: (await supabase.auth.getUser()).data.user!.id,
          file_name: file.name,
          total_rows: parsed.length,
          valid_rows: counts.valid,
          invalid_rows: counts.invalid,
          duplicate_rows: counts.duplicate,
          status: "previewed",
        })
        .select("id").single();
      if (jobErr) throw jobErr;

      await supabase.from("student_import_rows").insert(
        parsed.map((r) => ({
          import_id: job.id, row_number: r.row_number, roll_number: r.roll_number || null,
          raw_data: r.raw, validation_status: r.validation_status, error_message: r.error_message,
        })),
      );

      setImportId(job.id);
      setRows(parsed);
      setOpen(true);
    } catch (e: any) {
      toast({ title: "Could not read that file", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const tally = (list: ParsedRow[]) => ({
    valid: list.filter((r) => r.validation_status === "valid").length,
    invalid: list.filter((r) => r.validation_status === "invalid").length,
    duplicate: list.filter((r) => r.validation_status === "duplicate").length,
  });

  const commit = async () => {
    if (!rows || !importId) return;
    const good = rows.filter((r) => r.validation_status === "valid");
    if (good.length === 0) return;

    setBusy(true);
    await supabase.from("student_imports").update({ status: "committing" }).eq("id", importId);

    const { data, error } = await supabase.functions.invoke("create-student-users", {
      body: {
        college_id: collegeId,
        students: good.map((r) => ({
          name: r.name, email: r.email, phone: r.phone, roll_number: r.roll_number,
          branch: r.branch, batch: r.batch, year_of_study: r.batch,
        })),
      },
    });

    setBusy(false);

    if (error) {
      await supabase.from("student_imports").update({ status: "failed" }).eq("id", importId);
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
      return;
    }

    // Four things can happen to a row, and a college needs to be able to tell
    // them apart. "Linked" in particular used to be reported as a duplicate,
    // which read as "already handled" when in fact the student had been left
    // out of the college entirely.
    const results = (data?.results ?? []) as Array<{ status: string; email: string; message?: string }>;
    const count = (s: string) => results.filter((r) => r.status === s).length;
    const created = count("success");
    const linked = count("linked");
    const mine = count("already_yours");
    const elsewhere = count("other_college");
    const failed = count("error");

    await supabase.from("student_imports")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", importId);

    const lines = [
      created > 0 ? `${created} created and invited` : null,
      linked > 0 ? `${linked} had already signed up — linked to you, their work kept` : null,
      mine > 0 ? `${mine} already in your college` : null,
      elsewhere > 0 ? `${elsewhere} belong to another college — not changed` : null,
      failed > 0 ? `${failed} failed` : null,
    ].filter(Boolean);

    toast({
      title: `${created + linked} of ${good.length} students added`,
      description: lines.join(" · "),
      variant: elsewhere > 0 || failed > 0 ? "destructive" : undefined,
    });
    setOpen(false);
    setRows(null);
    onImported?.();
  };

  /** Hands the bad rows back so they can be fixed and uploaded again. */
  const downloadErrors = () => {
    if (!rows) return;
    const bad = rows.filter((r) => r.validation_status !== "valid");
    const csv = [
      "row,name,email,roll_number,problem",
      ...bad.map((r) => [r.row_number, r.name, r.email, r.roll_number, r.error_message]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.csv$/i, "") + "-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = rows ? tally(rows) : null;

  return (
    <>
      <input
        ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void parse(f); }}
      />
      <Button size="sm" disabled={busy || !collegeId} onClick={() => fileRef.current?.click()}>
        <Upload className="h-3.5 w-3.5 mr-1.5" />
        {busy ? "Reading…" : "Import students"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{fileName}</DialogTitle>
            <DialogDescription>
              Nothing has been created yet. Check the numbers, then commit.
            </DialogDescription>
          </DialogHeader>

          {counts && rows && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { k: "Rows", v: rows.length, tone: "" },
                  { k: "Valid", v: counts.valid, tone: "text-emerald-500" },
                  { k: "Duplicates", v: counts.duplicate, tone: "text-amber-500" },
                  { k: "Invalid", v: counts.invalid, tone: "text-destructive" },
                ].map((c) => (
                  <div key={c.k} className="rounded-lg border p-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {c.k}
                    </span>
                    <div className={`font-mono text-2xl font-bold tabular-nums ${c.tone}`}>{c.v}</div>
                  </div>
                ))}
              </div>

              {counts.invalid + counts.duplicate > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <tbody>
                      {rows.filter((r) => r.validation_status !== "valid").map((r) => (
                        <tr key={r.row_number} className="border-b last:border-b-0">
                          <td className="p-2 font-mono text-xs text-muted-foreground">#{r.row_number}</td>
                          <td className="p-2">{r.name || <span className="text-muted-foreground">—</span>}</td>
                          <td className="p-2 text-muted-foreground text-xs">{r.email}</td>
                          <td className="p-2 text-right">
                            <Badge variant={r.validation_status === "invalid" ? "destructive" : "outline"}>
                              {r.error_message}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {counts && counts.invalid + counts.duplicate > 0 && (
              <Button variant="outline" onClick={downloadErrors}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download error report
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !counts?.valid} onClick={() => void commit()}>
              {busy ? "Creating…" : `Import ${counts?.valid ?? 0} students`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TpoImportStudents;
