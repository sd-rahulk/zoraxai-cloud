import { dispatch } from "@/lib/server/api.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export { dispatch as GET, dispatch as POST, dispatch as PUT, dispatch as DELETE, dispatch as OPTIONS };
