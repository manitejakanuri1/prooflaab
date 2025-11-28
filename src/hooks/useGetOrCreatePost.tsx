import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * Hook to get or create a proof_posts entry for a proof_upload.
 * If a post already exists for the proof, returns its ID.
 * If not, creates a new post and returns the new ID.
 */
export const useGetOrCreatePost = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const getOrCreatePost = async (
    proofId: string,
    studentId: string,
    taskTitle?: string,
    isPublic?: boolean
  ): Promise<string | null> => {
    setLoading(true);
    try {
      // First, check if a post already exists for this proof
      const { data: existingPost, error: fetchError } = await supabase
        .from("proof_posts")
        .select("id")
        .eq("proof_id", proofId)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching post:", fetchError);
        throw fetchError;
      }

      if (existingPost) {
        setLoading(false);
        return existingPost.id;
      }

      // No existing post, create one
      // First get proof details
      const { data: proof, error: proofError } = await supabase
        .from("proof_uploads")
        .select(`
          id,
          student_id,
          is_public,
          ai_summary,
          submitted_at,
          tasks:task_id (
            title,
            required_skills
          )
        `)
        .eq("id", proofId)
        .single();

      if (proofError || !proof) {
        console.error("Error fetching proof:", proofError);
        throw proofError || new Error("Proof not found");
      }

      // Generate emoji code from task title
      const generateEmojiCode = (str: string) => {
        const emojis = ["1F680", "1F4BB", "1F3A8", "1F4A1", "1F31F", "1F525", "1F389", "1F4DA"];
        const index = (str.charCodeAt(0) + str.length) % emojis.length;
        return emojis[index];
      };

      const title = taskTitle || (proof.tasks as any)?.title || "Untitled Project";
      const emojiCode = generateEmojiCode(title);
      const skills = (proof.tasks as any)?.required_skills || [];

      // Create the post
      const { data: newPost, error: createError } = await supabase
        .from("proof_posts")
        .insert({
          proof_id: proofId,
          student_id: studentId || proof.student_id,
          title: title,
          description: proof.ai_summary || "A verified project completed through ProofLabAI.",
          emoji_code: emojiCode,
          skills: skills,
          visibility: isPublic ?? proof.is_public ? "public" : "private",
          verified_badge: true,
          status: "active",
        })
        .select("id")
        .single();

      if (createError) {
        console.error("Error creating post:", createError);
        throw createError;
      }

      setLoading(false);
      return newPost.id;
    } catch (error) {
      console.error("Error in getOrCreatePost:", error);
      toast({
        title: "Error",
        description: "Could not load post. Please try again.",
        variant: "destructive",
      });
      setLoading(false);
      return null;
    }
  };

  return { getOrCreatePost, loading };
};

/**
 * Utility function to get post ID from proof ID without hook context.
 * For use in components that just need to construct URLs.
 */
export const getPostIdForProof = async (proofId: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .from("proof_posts")
      .select("id")
      .eq("proof_id", proofId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching post ID:", error);
      return null;
    }

    return data?.id || null;
  } catch (error) {
    console.error("Error in getPostIdForProof:", error);
    return null;
  }
};
