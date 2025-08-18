-- Create the generate_unique_slug function that's needed for student profile creation
CREATE OR REPLACE FUNCTION generate_unique_slug(input_text text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    base_slug text;
    final_slug text;
    counter integer := 0;
BEGIN
    -- Convert to lowercase, replace spaces with hyphens, remove special characters
    base_slug := lower(regexp_replace(input_text, '[^a-zA-Z0-9\s]', '', 'g'));
    base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
    base_slug := trim(both '-' from base_slug);
    
    -- If empty after cleaning, use 'user'
    IF base_slug = '' THEN
        base_slug := 'user';
    END IF;
    
    final_slug := base_slug;
    
    -- Check if slug exists and increment counter if needed
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE portfolio_slug = final_slug) LOOP
        counter := counter + 1;
        final_slug := base_slug || '-' || counter::text;
    END LOOP;
    
    RETURN final_slug;
END;
$$;