import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { NAV_PLACES } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

const PLACE_IDS = NAV_PLACES.map((place) => place.id) as [string, ...string[]];

const RequestSchema = z.object({
  utterance: z.string().trim().min(1).max(300),
  expecting: z.enum(["origin", "destination", "journey"]),
});

const ResolutionSchema = z.object({
  origin: z.enum(PLACE_IDS).nullable(),
  destination: z.enum(PLACE_IDS).nullable(),
  clarification: z.string().nullable(),
});

// Stable across requests so the prefix can be cached.
const SYSTEM = `You are the voice navigation assistant for the VJTI campus app. Students speak to you; speech-to-text may mishear names (e.g. "siemens" for "SIMENS", "a l double oh five" for "AL005").

Map what the student said onto the ground-floor places below. Only ever answer with ids from this list:
${NAV_PLACES.map((place) => `- ${place.id}: ${place.aliases.join(" / ")}`).join("\n")}

Rules:
- "origin" is where the student is now; "destination" is where they want to go.
- The request says which one the app just asked for. Fill that field; fill the other only if the student clearly mentioned it too.
- Use null for a field you cannot map with reasonable confidence. Never guess between two similar places (for example boys vs girls washroom).
- When a field the app asked for is null, put one short spoken follow-up question in "clarification" (e.g. "Do you mean the boys or the girls washroom?"). Otherwise set it to null.`;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export async function POST(request: Request) {
  if (!client) {
    return NextResponse.json({ error: "AI place matching is not configured." }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  }
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(ResolutionSchema) },
      messages: [{ role: "user", content: `The app asked for: ${parsed.data.expecting}\nThe student said: "${parsed.data.utterance}"` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json({ origin: null, destination: null, clarification: "Sorry, I didn't catch that. Could you name the room again?" });
    }
    return NextResponse.json(response.parsed_output);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "The assistant is busy. Try again in a moment." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: "The assistant could not understand that right now." }, { status: 502 });
    }
    throw error;
  }
}
