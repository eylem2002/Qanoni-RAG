import { db } from "@workspace/db";
import { laws, contractLawMappings } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

export type ContractType =
  | "employment"
  | "rental"
  | "service"
  | "nda"
  | "supplier";

export class RagLawRetriever {
  async getRelevantLawsForContractType(
    contractType: ContractType
  ): Promise<string> {
    const mappings = await db
      .select()
      .from(contractLawMappings)
      .where(eq(contractLawMappings.contractType, contractType))
      .orderBy(asc(contractLawMappings.priority));

    if (mappings.length === 0) {
      return "";
    }

    let legalContext = "=== المراجع القانونية ===\n\n";
    let lawsCount = 0;

    for (const mapping of mappings) {
      try {
        const law = await db
          .select()
          .from(laws)
          .where(eq(laws.lawId, mapping.lawId))
          .limit(1);

        if (!law || law.length === 0) {
          continue;
        }

        lawsCount++;
        const relevantArticles = mapping.relevantArticles as number[];
        const relevantText = this.extractArticles(law[0]!.fullText, relevantArticles);

        legalContext += `\n📋 ${law[0]!.arabicName} (${mapping.lawId})\n`;
        legalContext += `المواد ذات الصلة: ${relevantArticles.join(", ")}\n`;
        legalContext += "─".repeat(50) + "\n";
        legalContext += relevantText;
        legalContext += "\n";
      } catch (error) {
        console.error(`[RAG] Error retrieving law ${mapping.lawId}:`, error);
      }
    }

    legalContext += `\n[تم استرجاع ${lawsCount} قانون(ين) بنجاح من قاعدة البيانات]`;
    return legalContext;
  }

  private extractArticles(lawText: string, articleNumbers: number[]): string {
    if (articleNumbers.length === 0) {
      return lawText;
    }

    const articleRegex = /المادة\s+(\d+)\s*:\s*(.+?)(?=المادة\s+\d+|$)/gs;
    const extractedArticles: string[] = [];
    let match;

    while ((match = articleRegex.exec(lawText)) !== null) {
      const articleNum = parseInt(match[1]!);
      if (articleNumbers.includes(articleNum)) {
        extractedArticles.push(`المادة ${articleNum}:\n${match[2]!.trim()}`);
      }
    }

    if (extractedArticles.length === 0) {
      return lawText;
    }

    return extractedArticles.join("\n\n");
  }

  async getAllLawsForContractType(contractType: ContractType): Promise<string> {
    const mappings = await db
      .select()
      .from(contractLawMappings)
      .where(eq(contractLawMappings.contractType, contractType));

    let context = "";

    for (const mapping of mappings) {
      const law = await db
        .select()
        .from(laws)
        .where(eq(laws.lawId, mapping.lawId))
        .limit(1);

      if (law.length > 0) {
        context += `\n\n${law[0]!.arabicName}\n${"=".repeat(50)}\n${law[0]!.fullText}`;
      }
    }

    return context;
  }
}

export const ragRetriever = new RagLawRetriever();
