import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Link, FileText, Video, Image } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { IntegrityDeclarationModal } from "./IntegrityDeclarationModal";

interface UploadProofModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  taskTitle: string;
  onSuccess?: (proofId?: string, quizPending?: boolean) => void;
}

export default function UploadProofModal({ 
  isOpen, 
  onClose, 
  taskId, 
  taskTitle,
  onSuccess 
}: UploadProofModalProps) {
  const [uploadType, setUploadType] = useState<'link' | 'file'>('link');
  const [linkUrl, setLinkUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeclarationModal, setShowDeclarationModal] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const acceptedFileTypes = {
    'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    'video/*': ['.mp4', '.avi', '.mov', '.wmv', '.mkv'],
    'application/pdf': ['.pdf'],
    'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.doc', '.docx'],
    'text/plain': ['.txt']
  };

  /**
   * Matches the bucket's allowed_mime_types exactly.
   *
   * Storage refuses anything outside this list, so a mismatch here would mean a
   * student picks a file, waits, and is told "upload failed" with no reason.
   * The bucket is the real gate; this is so the message arrives before the wait.
   */
  const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];

  /** The 10MB the UI has always promised, now actually enforced. */
  const MAX_FILE_BYTES = 10 * 1024 * 1024;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again after an error still fires onChange.
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: "File too large",
        description: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 10MB.`,
        variant: "destructive",
      });
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast({
        title: "That file type isn't supported",
        description: "Please upload an image, video, PDF, Word document or text file.",
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to submit proof.",
        variant: "destructive",
      });
      return;
    }

    if (uploadType === 'link' && !linkUrl.trim()) {
      toast({
        title: "Error",
        description: "Please provide a valid link.",
        variant: "destructive",
      });
      return;
    }

    if (uploadType === 'file' && !selectedFile) {
      toast({
        title: "Error",
        description: "Please select a file to upload.",
        variant: "destructive",
      });
      return;
    }

    // Show integrity declaration modal
    setShowDeclarationModal(true);
  };

  const handleDeclarationConfirm = async (declaration: { acknowledged: boolean; text?: string }) => {
    setShowDeclarationModal(false);
    setIsSubmitting(true);

    try {
      // Get student profile ID
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) {
        throw new Error('Student profile not found');
      }

      // One proof per task per student — blocks duplicates in ANY state
      // ('Under Review', 'needs_review', 'Rejected', 'Verified'), not just under review.
      const { data: existingProof } = await supabase
        .from('proof_uploads')
        .select('id')
        .eq('task_id', taskId)
        .eq('student_id', profile.id)
        .limit(1)
        .maybeSingle();

      if (existingProof) {
        toast({
          title: "Already Submitted",
          description: "You have already submitted proof for this task.",
        });
        onClose();
        return;
      }

      // A link submission keeps file_url; a file submission uploads for real and
      // records where it landed. These were the same field before, which is how
      // "[FILE: report.pdf]" ended up being served to reviewers as the proof.
      let fileUrl: string | null = uploadType === 'link' ? linkUrl.trim() : null;
      let filePath: string | null = null;

      if (uploadType === 'file' && selectedFile) {
        // Foldered by user id because that is what the storage policy checks.
        // The name is sanitised so a file called "../../x" or one with spaces
        // cannot produce a path the policy reads differently from this code.
        const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const candidate = `${user.id}/${taskId}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('proofs')
          .upload(candidate, selectedFile, {
            upsert: false,
            contentType: selectedFile.type || 'application/octet-stream',
          });

        if (uploadError) {
          // Thrown rather than swallowed: a proof row with no file behind it is
          // exactly the bug this replaces.
          throw new Error(`Could not upload your file: ${uploadError.message}`);
        }
        filePath = candidate;
      }

      // Insert proof upload record with declaration
      const { data: proofData, error } = await supabase
        .from('proof_uploads')
        .insert({
          task_id: taskId,
          student_id: profile.id,
          file_url: fileUrl,
          file_path: filePath,
          file_name: selectedFile?.name ?? null,
          file_size: selectedFile?.size ?? null,
          file_type: selectedFile?.type ?? null,
          submission_notes: submissionNotes.trim() || null,
          declaration_acknowledged: declaration.acknowledged,
          declaration_text: declaration.text || null,
          status: 'Under Review'
        })
        .select()
        .single();

      if (error) {
        // The file is already in the bucket at this point. Leaving it there
        // would orphan it and, worse, the next attempt would hit the same path
        // guard, so clean up before surfacing the failure.
        if (filePath) {
          await supabase.storage.from('proofs').remove([filePath]);
        }
        throw error;
      }

      // Log declaration in audit logs
      if (declaration.acknowledged) {
        await supabase.from('audit_logs').insert({
          user_id: user.id,
          action: 'declaration_submitted',
          table_name: 'proof_uploads',
          record_id: proofData.id,
          new_values: {
            declaration_acknowledged: true,
            declaration_text: declaration.text
          }
        });
      }

      // GitHub repo proofs: generate the conceptual quiz right away instead
      // of waiting for a college/admin to run verification manually
      const isGithubRepo = !!fileUrl && /github\.com\/[^/]+\/[^/]+/.test(fileUrl);
      if (isGithubRepo) {
        supabase.functions
          .invoke('question-generator', {
            body: { proof_id: proofData.id, repo_url: fileUrl, top_n: 3 }
          })
          .then(({ error: genError }) => {
            if (genError) console.error('Quiz generation failed:', genError);
          });
      }

      toast({
        title: "Proof Submitted",
        description: isGithubRepo
          ? `Proof for "${taskTitle}" submitted! Your "Do You Know Your Code?" quiz will be ready in about a minute.`
          : `Your proof for "${taskTitle}" has been submitted successfully!`,
      });

      // Reset form
      setLinkUrl('');
      setSelectedFile(null);
      setSubmissionNotes('');
      onSuccess?.(proofData.id, isGithubRepo);
      onClose();
    } catch (error) {
      console.error('Error submitting proof:', error);
      toast({
        title: "Error",
        // The real reason, not "please try again" — a file over the limit or of
        // the wrong type is something the student can actually act on.
        description:
          error instanceof Error && error.message
            ? error.message
            : "Failed to submit proof. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return <Image className="h-4 w-4" />;
    if (fileType.startsWith('video/')) return <Video className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Proof
          </DialogTitle>
          <DialogDescription>
            Submit proof for: <span className="font-medium">{taskTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={uploadType} onValueChange={(value) => setUploadType(value as 'link' | 'file')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link" className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              Link
            </TabsTrigger>
            <TabsTrigger value="file" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="link-url">Link URL</Label>
              <Input
                id="link-url"
                type="url"
                placeholder="https://example.com/your-proof"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Provide a link to your work (GitHub repo, Google Drive, etc.)
              </p>
            </div>
          </TabsContent>

          <TabsContent value="file" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Select File</Label>
              <Input
                id="file-upload"
                type="file"
                onChange={handleFileChange}
                accept={Object.keys(acceptedFileTypes).join(',')}
                className="cursor-pointer"
              />
              {selectedFile && (
                <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                  {getFileIcon(selectedFile.type)}
                  <span className="text-sm truncate">{selectedFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Supported: Images, Videos, PDFs, Documents (Max 10MB)
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-2">
          <Label htmlFor="submission-notes">Additional Notes (Optional)</Label>
          <Textarea
            id="submission-notes"
            placeholder="Add any additional information about your submission..."
            value={submissionNotes}
            onChange={(e) => setSubmissionNotes(e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting
              ? uploadType === 'file'
                ? "Uploading…"
                : "Submitting…"
              : "Submit Proof"}
          </Button>
        </div>
      </DialogContent>

      <IntegrityDeclarationModal
        open={showDeclarationModal}
        onConfirm={handleDeclarationConfirm}
        onCancel={() => setShowDeclarationModal(false)}
      />
    </Dialog>
  );
}