import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, X } from "lucide-react";
import { z } from "zod";

const COMMON_SKILLS = [
  "Python",
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "SQL",
  "MongoDB",
  "PostgreSQL",
  "Machine Learning",
  "Data Visualization",
  "API Development",
  "UI/UX Design",
  "Figma",
  "Docker",
  "AWS",
  "Git",
];

const EMOJI_OPTIONS = [
  { emoji: "🚀", code: "1F680" },
  { emoji: "💻", code: "1F4BB" },
  { emoji: "🎨", code: "1F3A8" },
  { emoji: "📱", code: "1F4F1" },
  { emoji: "⚡", code: "26A1" },
  { emoji: "🔥", code: "1F525" },
  { emoji: "✨", code: "2728" },
  { emoji: "🎯", code: "1F3AF" },
  { emoji: "🌟", code: "1F31F" },
  { emoji: "🏆", code: "1F3C6" },
];

const verifiedPostSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200, "Title must be less than 200 characters"),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(2000, "Description must be less than 2000 characters"),
  skills: z.array(z.string()).min(1, "Select at least one skill"),
  emojiCode: z.string().min(1, "Select an emoji"),
});

interface VerifiedPostComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  proofId: string;
  onPostSuccess: () => void;
}

interface ProofData {
  id: string;
  task_id: string;
  tasks: {
    title: string;
    description: string | null;
    required_skills: string[] | null;
  };
}

const VerifiedPostComposerModal = ({
  isOpen,
  onClose,
  proofId,
  onPostSuccess,
}: VerifiedPostComposerModalProps) => {
  const [proof, setProof] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [customSkill, setCustomSkill] = useState("");
  const [emojiCode, setEmojiCode] = useState("1F680");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existingPostId, setExistingPostId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && proofId) {
      fetchProofDetails();
      checkExistingPost();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, proofId]);

  const checkExistingPost = async () => {
    const { data } = await supabase
      .from("proof_posts")
      .select("id")
      .eq("proof_id", proofId)
      .maybeSingle();
    setExistingPostId(data?.id || null);
  };

  const fetchProofDetails = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("proof_uploads")
        .select(`
          id,
          task_id,
          tasks (
            title,
            description,
            required_skills
          )
        `)
        .eq("id", proofId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching proof:", error);
        toast.error("Failed to load proof details");
        return;
      }

      const proofData = data as ProofData;
      setProof(proofData);

      // Auto-fill form
      setTitle(proofData.tasks?.title || "");
      setDescription(proofData.tasks?.description || "");
      setSkills(proofData.tasks?.required_skills || []);
      setEmojiCode("1F680");
    } catch (error) {
      console.error("Error:", error);
      toast.error("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTitle("");
    setDescription("");
    setSkills([]);
    setCustomSkill("");
    setEmojiCode("1F680");
    setErrors({});
    setProof(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const toggleSkill = (skill: string) => {
    setSkills((prev) =>
      prev.includes(skill)
        ? prev.filter((s) => s !== skill)
        : [...prev, skill]
    );
  };

  const addCustomSkill = () => {
    const trimmedSkill = customSkill.trim();
    if (trimmedSkill && !skills.includes(trimmedSkill)) {
      setSkills((prev) => [...prev, trimmedSkill]);
      setCustomSkill("");
    }
  };

  const removeSkill = (skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
  };

  const handleSubmit = async () => {
    try {
      // Validate form data
      const validationResult = verifiedPostSchema.safeParse({
        title,
        description,
        skills,
        emojiCode,
      });

      if (!validationResult.success) {
        const newErrors: Record<string, string> = {};
        validationResult.error.issues.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
        toast.error("Please fix the errors in the form");
        return;
      }

      setErrors({});
      setIsSubmitting(true);

      // Call RPC function to create proof post
      const { error } = await supabase.rpc("create_proof_post", {
        p_proof_id: proofId,
        p_title: validationResult.data.title,
        p_description: validationResult.data.description,
        p_emoji_code: validationResult.data.emojiCode,
        p_skills: validationResult.data.skills,
        p_visibility: "public",
      });

      if (error) {
        console.error("Error creating post:", error);
        toast.error("Failed to create post");
        return;
      }

      toast.success("Verified Proof posted successfully!");
      handleReset();
      onClose();
      onPostSuccess();
    } catch (error) {
      console.error("Error:", error);
      toast.error("An error occurred while posting");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Share Verified Proof
          </DialogTitle>
          <DialogDescription>
            This post will appear as a Verified ProofLabAI achievement
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading proof details...</div>
          </div>
        ) : (
          <>
            {/* Verified Badge */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-600 dark:text-green-400">
                Verified Proof • ProofLabAI
              </span>
            </div>

            {/* View Proof Link - links to post page if post exists, otherwise to proof viewer */}
            {proof && existingPostId && (
              <a
                href={`/post/${existingPostId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                <span>View Post</span>
              </a>
            )}

            <div className="space-y-4 mt-4">
              {/* Title */}
              <div>
                <Label htmlFor="title">Project Title *</Label>
                <Input
                  id="title"
                  placeholder="My Awesome Project"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={errors.title ? "border-red-500" : ""}
                />
                {errors.title && (
                  <p className="text-sm text-red-500 mt-1">{errors.title}</p>
                )}
              </div>

              {/* Description */}
              <div>
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what you built and what tools you used..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className={errors.description ? "border-red-500" : ""}
                />
                {errors.description && (
                  <p className="text-sm text-red-500 mt-1">{errors.description}</p>
                )}
              </div>

              {/* Skills/Tags */}
              <div>
                <Label>Skills / Technologies *</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {COMMON_SKILLS.map((skill) => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                        skills.includes(skill)
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {skill}
                    </button>
                  ))}
                </div>

                {/* Custom skill input */}
                <div className="flex gap-2 mt-3">
                  <Input
                    placeholder="Add custom skill..."
                    value={customSkill}
                    onChange={(e) => setCustomSkill(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomSkill();
                      }
                    }}
                  />
                  <Button type="button" onClick={addCustomSkill} variant="outline">
                    Add
                  </Button>
                </div>

                {/* Selected skills */}
                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {skills.map((skill) => (
                      <div
                        key={skill}
                        className="flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-primary-foreground text-sm"
                      >
                        {skill}
                        <button
                          type="button"
                          onClick={() => removeSkill(skill)}
                          className="hover:bg-primary-foreground/20 rounded-full p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {errors.skills && (
                  <p className="text-sm text-red-500 mt-1">{errors.skills}</p>
                )}
              </div>

              {/* Emoji Picker */}
              <div>
                <Label>Choose an Emoji *</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {EMOJI_OPTIONS.map((option) => (
                    <button
                      key={option.code}
                      type="button"
                      onClick={() => setEmojiCode(option.code)}
                      className={`w-12 h-12 text-2xl rounded-lg transition-all ${
                        emojiCode === option.code
                          ? "bg-primary/20 ring-2 ring-primary scale-110"
                          : "bg-secondary hover:bg-secondary/80"
                      }`}
                    >
                      {option.emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? "Posting..." : "Post Verified Proof"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default VerifiedPostComposerModal;
