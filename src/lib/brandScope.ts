import { createContext, useContext } from "react";

/** The brand classes of the page around a pop-up. Pop-ups render outside the page
 * (portals), so they add these classes themselves: "pl-landing dark" inside
 * BrandFrame (always dark), "pl-landing" in the student dashboard (follows the
 * light/dark switch). Empty everywhere else. */
export const BrandScope = createContext("");

export const useBrandScopeClass = () => useContext(BrandScope);
