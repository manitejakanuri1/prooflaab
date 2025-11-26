import { useState } from "react";
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
import { ExternalLink, X } from "lucide-react";
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
  { emoji: "🔗", code: "1F517" },
  { emoji: "💻", code: "1F4BB" },
  { emoji: "🚀", code: "1F680" },
  { emoji: "🎨", code: "1F3A8" },
  { emoji: "📱", code: "1F4F1" },
  { emoji: "⚡", code: "26A1" },
  { emoji: "🔥", code: "1F525" },
  { emoji: "✨", code: "2728" },
  { emoji: "🎯", code: "1F3AF" },
  { emoji: "🌟", code: "1F31F" },
];

const externalProjectSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200, "Title must be less than 200 characters"),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(2000, "Description must be less than 2000 characters"),
  externalLink: z.string().trim().url("Must be a valid URL").refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
    message: "URL must start with http:// or https://",
  }),
  skills: z.array(z.string()).min(1, "Select at least one skill"),
  emojiCode: z.string().min(1, "Select an emoji"),
});

interface ExternalProjectPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostSuccess: () => void;
}

const ExternalProjectPostModal = ({
  isOpen,
  onClose,
  onPostSuccess,
}: ExternalProjectPostModalProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [customSkill, setCustomSkill] = useState("");
  const [emojiCode, setEmojiCode] = useState("1F517");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleReset = () => {
    setTitle("");
    setDescription("");
    setExternalLink("");
    setSkills([]);
    setCustomSkill("");
    setEmojiCode("1F517");
    setErrors({});
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
      const validationResult = externalProjectSchema.safeParse({
        title,
        description,
        externalLink,
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

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to post");
        return;
      }

      // Get student profile
      const { data: profile } = await supabase
        .from("student_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile) {
        toast.error("Student profile not found");
        return;
      }

      // Insert post
      const { error } = await supabase.from("proof_posts").insert({
        student_id: profile.id,
        proof_id: null,
        title: validationResult.data.title,
        description: validationResult.data.description,
        external_link: validationResult.data.externalLink,
        skills: validationResult.data.skills,
        emoji_code: validationResult.data.emojiCode,
        visibility: "public",
        verified_badge: false,
        status: "active",
      });

      if (error) {
        console.error("Error creating post:", error);
        toast.error("Failed to create post");
        return;
      }

      toast.success("External project posted successfully!");
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
            <ExternalLink className="w-5 h-5" />
            Share External Project
          </DialogTitle>
          <DialogDescription>
            Share work you've done outside of ProofLabAI
          </DialogDescription>
        </DialogHeader>

        {/* Unverified Badge */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <ExternalLink className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Unverified • External Project
          </span>
        </div>

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

          {/* External Link */}
          <div>
            <Label htmlFor="externalLink">Project Link *</Label>
            <Input
              id="externalLink"
              type="url"
              placeholder="https://github.com/username/project"
              value={externalLink}
              onChange={(e) => setExternalLink(e.target.value)}
              className={errors.externalLink ? "border-red-500" : ""}
            />
            {errors.externalLink && (
              <p className="text-sm text-red-500 mt-1">{errors.externalLink}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              GitHub, YouTube, Figma, Drive, or any external link
            </p>
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
            {isSubmitting ? "Posting..." : "Post Project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExternalProjectPostModal;
