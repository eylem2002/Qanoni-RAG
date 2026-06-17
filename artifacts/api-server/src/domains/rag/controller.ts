import type { Request, Response } from "express";
import * as RagLogic from "./logic/RagLogic";

const VALID_CONTRACT_TYPES = [
  "employment",
  "rental",
  "service",
  "nda",
  "supplier",
] as const;
type ContractType = (typeof VALID_CONTRACT_TYPES)[number];

/**
 * GET /api/rag/retrieve?contractType=employment
 *
 * Public endpoint — no auth required.
 * Called by the Contract System to fetch relevant law articles before
 * generating a contract. Returns structured article data with version
 * tracking so the contract system knows which law version was used.
 */
export async function retrieve(req: Request, res: Response) {
  const contractType = req.query["contractType"] as string | undefined;

  if (!contractType) {
    return res.status(400).json({
      error: "Missing required query parameter: contractType",
      validValues: VALID_CONTRACT_TYPES,
    });
  }

  if (!VALID_CONTRACT_TYPES.includes(contractType as ContractType)) {
    return res.status(400).json({
      error: `Invalid contractType: "${contractType}"`,
      validValues: VALID_CONTRACT_TYPES,
    });
  }

  try {
    const result = await RagLogic.retrieveArticles(contractType, req.log);

    if (result === null) {
      return res.status(404).json({
        error: `No law mappings found for contractType: "${contractType}"`,
      });
    }

    return res.json(result);
  } catch (error) {
    req.log.error({ error }, "[RAG] Error retrieving articles");
    return res.status(500).json({ error: "Internal server error" });
  }
}
