import { NextRequest, NextResponse } from "next/server";
import { agentApiContract } from "@/lib/agent";
import { catalogueFromStore } from "@/lib/query";
import { readStore } from "@/lib/store";

export const runtime = "nodejs";

/** Agent discovery index — start here instead of browsing the HTML UI. */
export async function GET(req: NextRequest) {
  const store = await readStore();
  const catalogue = catalogueFromStore(store);
  const baseUrl = req.nextUrl.origin;

  return NextResponse.json({
    ...agentApiContract(baseUrl),
    live: {
      syncedAt: store.syncedAt,
      originPostcode: store.originPostcode,
      maxDriveMinutes: store.maxDriveMinutes,
      activityCount: store.activities.length,
      features: catalogue.features,
      sources: catalogue.sources,
      terrains: catalogue.terrains,
      categories: catalogue.categories,
      sourceStatuses: store.sourceStatuses,
    },
  });
}
