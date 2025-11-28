import { useEffect } from "react";

interface SEOConfig {
  title: string;
  description: string;
  url?: string;
  image?: string;
  type?: "website" | "article" | "profile";
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  siteName?: string;
  twitterCard?: "summary" | "summary_large_image";
  jsonLd?: object;
}

/**
 * Custom hook to manage SEO meta tags dynamically.
 * Works for both logged-in and logged-out users.
 */
export const useSEO = (config: SEOConfig) => {
  useEffect(() => {
    if (!config.title) return;

    const {
      title,
      description,
      url,
      image,
      type = "website",
      publishedTime,
      modifiedTime,
      author,
      siteName = "ProofLabAI",
      twitterCard = "summary_large_image",
      jsonLd,
    } = config;

    // Update document title
    document.title = title;

    // Helper to set meta tag
    const setMeta = (name: string, content: string, isProperty = false) => {
      if (!content) return;
      const attr = isProperty ? "property" : "name";
      let meta = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", content);
    };

    // Helper to set link tag
    const setLink = (rel: string, href: string) => {
      if (!href) return;
      let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", rel);
        document.head.appendChild(link);
      }
      link.setAttribute("href", href);
    };

    // Basic meta tags
    setMeta("description", description);
    setMeta("author", author || "ProofLabAI");

    // Canonical URL
    if (url) {
      setLink("canonical", url);
    }

    // OpenGraph tags
    setMeta("og:title", title, true);
    setMeta("og:description", description, true);
    setMeta("og:type", type, true);
    setMeta("og:site_name", siteName, true);
    if (url) setMeta("og:url", url, true);
    if (image) setMeta("og:image", image, true);
    if (publishedTime) setMeta("article:published_time", publishedTime, true);
    if (modifiedTime) setMeta("article:modified_time", modifiedTime, true);
    if (author) setMeta("article:author", author, true);

    // Twitter Card tags
    setMeta("twitter:card", twitterCard);
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    if (image) setMeta("twitter:image", image);
    setMeta("twitter:site", "@ProofLabAI");

    // JSON-LD Structured Data
    if (jsonLd) {
      let script = document.querySelector('script[type="application/ld+json"]') as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.setAttribute("type", "application/ld+json");
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(jsonLd);
    }

    // Cleanup function
    return () => {
      document.title = "ProofLabAI";
    };
  }, [config.title, config.description, config.url, config.image, config.type]);
};

/**
 * Generate JSON-LD for Article schema (posts)
 */
export const generateArticleJsonLd = ({
  title,
  description,
  authorName,
  datePublished,
  dateModified,
  image,
  url,
}: {
  title: string;
  description: string;
  authorName: string;
  datePublished: string;
  dateModified?: string;
  image?: string;
  url: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  headline: title,
  description,
  author: {
    "@type": "Person",
    name: authorName,
  },
  publisher: {
    "@type": "Organization",
    name: "ProofLabAI",
    url: "https://prooflab.ai",
    logo: {
      "@type": "ImageObject",
      url: "https://prooflab.ai/logo.png",
    },
  },
  datePublished,
  dateModified: dateModified || datePublished,
  image: image || "https://prooflab.ai/og-default.png",
  url,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": url,
  },
});

/**
 * Generate JSON-LD for Person/Profile schema (portfolios)
 */
export const generatePersonJsonLd = ({
  name,
  description,
  image,
  url,
  skills,
}: {
  name: string;
  description: string;
  image?: string;
  url: string;
  skills?: string[];
}) => ({
  "@context": "https://schema.org",
  "@type": "Person",
  name,
  description,
  image: image || undefined,
  url,
  knowsAbout: skills || [],
  memberOf: {
    "@type": "Organization",
    name: "ProofLabAI",
    url: "https://prooflab.ai",
  },
});

/**
 * Generate an emoji-based placeholder image URL
 */
export const generateEmojiImageUrl = (emojiCode: string): string => {
  // Using a service like Unicode emoji images or a fallback
  // This generates a URL that represents the emoji
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${emojiCode.toLowerCase()}.png`;
};

/**
 * Default OG image fallback
 */
export const DEFAULT_OG_IMAGE = "https://prooflab.ai/og-default.png";
