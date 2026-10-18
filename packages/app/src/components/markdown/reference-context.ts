import { createContext } from "react";
import type { ReferenceDetail } from "@/attachments/reference-details";
export const MarkdownReferenceContext = createContext<ReadonlyMap<string, ReferenceDetail>>(
  new Map(),
);
