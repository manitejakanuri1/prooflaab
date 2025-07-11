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

interface UploadProofModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  taskTitle: string;
  onSuccess?: () => void;
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
  const { toast } = useToast();
  const { user } = useAuth();

  const acceptedFileTypes = {
    'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    'video/*': ['.mp4', '.avi', '.mov', '.wmv', '.mkv'],
    'application/pdf': ['.pdf'],
    'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.doc', '.docx'],
    'text/plain': ['.txt']
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
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

      let fileUrl = linkUrl;

      // If uploading a file, we'll store the file info for now
      // In a real implementation, you'd upload to Supabase Storage
      if (uploadType === 'file' && selectedFile) {
        // For now, we'll store file details as a JSON string
        // In production, upload to Supabase Storage and get the public URL
        fileUrl = `[FILE: ${selectedFile.name} (${selectedFile.type}, ${selectedFile.size} bytes)]`;
      }

      // Insert proof upload record
      const { error } = await supabase
        .from('proof_uploads')
        .insert({
          task_id: taskId,
          student_id: profile.id,
          file_url: fileUrl,
          submission_notes: submissionNotes.trim() || null,
          status: 'Under Review'
        });

      if (error) throw error;

      toast({
        title: "Proof Submitted",
        description: `Your proof for "${taskTitle}" has been submitted successfully!`,
      });

      // Reset form
      setLinkUrl('');
      setSelectedFile(null);
      setSubmissionNotes('');
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Error submitting proof:', error);
      toast({
        title: "Error",
        description: "Failed to submit proof. Please try again.",
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
            {isSubmitting ? "Submitting..." : "Submit Proof"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}