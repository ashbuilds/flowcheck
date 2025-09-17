import { z } from "zod";
import type { ExtractSchema } from "./types.js";

export function buildZodFromExtractSchema(schema: ExtractSchema): z.ZodTypeAny {
  switch (schema.type) {
    case "string": {
      let s = z.string();
      if (schema.description) s = s.describe(schema.description);
      return s;
    }
    case "number": {
      let s = z.number();
      if (schema.description) s = s.describe(schema.description);
      return s;
    }
    case "boolean": {
      let s = z.boolean();
      if (schema.description) s = s.describe(schema.description);
      return s;
    }
    case "array": {
      const item = buildZodFromExtractSchema(schema.items);
      let s = z.array(item);
      if (schema.description) s = s.describe(schema.description);
      return s;
    }
    case "object": {
      const props = Object.fromEntries(
        Object.entries(schema.properties).map(([k, v]) => [k, buildZodFromExtractSchema(v)])
      );
      let s = z.object(props as any);
      if (schema.required && schema.required.length > 0) {
        // Mark required by refining optional props
        const requiredSet = new Set(schema.required);
        s = z.object(
          Object.fromEntries(
            Object.entries(props).map(([k, v]) => {
              const isReq = requiredSet.has(k);
              // If not required, make optional
              return [k, isReq ? (v as z.ZodTypeAny) : (v as z.ZodTypeAny).optional()];
            })
          ) as any
        );
      }
      if (schema.description) s = s.describe(schema.description);
      return s;
    }
    default:
      throw new Error(`Unsupported ExtractSchema type: ${(schema as any)?.type}`);
  }
}
