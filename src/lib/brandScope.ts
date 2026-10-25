import { createContext, useContext } from "react";

/** True inside BrandFrame. Pop-ups render outside the page (portals), so they
 * add the brand classes themselves to match the dark brand frame. */
export const BrandScope = createContext(false);

export const useBrandScopeClass = () => (useContext(BrandScope) ? "pl-landing dark" : "");
