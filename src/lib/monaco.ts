import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

/**
 * Monaco is loaded from the locally installed npm package.
 *
 * Monaco 0.56 reorganized its public ESM entry points. Do not import the old
 * internal esm/vs/... worker files directly: those paths are no longer a
 * stable integration surface in this version.
 *
 * Supplying the local Monaco module to @monaco-editor/react prevents its
 * default CDN loader from being used. Monaco/Vite handle the runtime worker
 * implementation from the installed package.
 */
loader.config({ monaco });

export { monaco };
