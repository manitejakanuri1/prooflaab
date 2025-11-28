import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Redirect component that checks if a proof has an associated post
 * and redirects to the public post page if it exists.
 * Otherwise, redirects to 404 since we're deprecating direct proof routes.
 */
const ProofRedirect = () => {
  const { id: proofId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const findAndRedirect = async () => {
      if (!proofId) {
        navigate("/not-found", { replace: true });
        return;
      }

      try {
        // Check if there's an existing post for this proof
        const { data: existingPost } = await supabase
          .from("proof_posts")
          .select("id")
          .eq("proof_id", proofId)
          .maybeSingle();

        if (existingPost) {
          // Redirect to the post page
          navigate(`/post/${existingPost.id}`, { replace: true });
          return;
        }

        // No post exists, try to create one
        // First, get proof details
        const { data: proof, error: proofError } = await supabase
          .from("proof_uploads")
          .select(`
            id,
            student_id,
            is_public,
            status,
            ai_summary,
            tasks:task_id (
              title,
              required_skills
            )
          `)
          .eq("id", proofId)
          .single();

        if (proofError || !proof) {
          console.error("Proof not found:", proofError);
          navigate("/not-found", { replace: true });
          return;
        }

        // Only create post for verified proofs
        if (proof.status !== "Verified") {
          // For non-verified proofs, show not found
          navigate("/not-found", { replace: true });
          return;
        }

        // Generate emoji code from task title
        const generateEmojiCode = (str: string) => {
          const emojis = ["1F680", "1F4BB", "1F3A8", "1F4A1", "1F31F", "1F525", "1F389", "1F4DA"];
          const index = (str.charCodeAt(0) + str.length) % emojis.length;
          return emojis[index];
        };

        const taskData = proof.tasks as { title: string; required_skills: string[] | null } | null;
        const title = taskData?.title || "Untitled Project";
        const emojiCode = generateEmojiCode(title);
        const skills = taskData?.required_skills || [];

        // Create the post
        const { data: newPost, error: createError } = await supabase
          .from("proof_posts")
          .insert({
            proof_id: proofId,
            student_id: proof.student_id,
            title: title,
            description: proof.ai_summary || "A verified project completed through ProofLabAI.",
            emoji_code: emojiCode,
            skills: skills,
            visibility: proof.is_public ? "public" : "private",
            verified_badge: true,
            status: "active",
          })
          .select("id")
          .single();

        if (createError) {
          console.error("Error creating post:", createError);
          navigate("/not-found", { replace: true });
          return;
        }

        // Redirect to the new post
        navigate(`/post/${newPost.id}`, { replace: true });
      } catch (error) {
        console.error("Error in proof redirect:", error);
        navigate("/not-found", { replace: true });
      } finally {
        setLoading(false);
      }
    };

    findAndRedirect();
  }, [proofId, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Redirecting to post...</p>
        </div>
      </div>
    );
  }

  return null;
};

export default ProofRedirect;
