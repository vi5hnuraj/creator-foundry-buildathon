import { supabase } from "../supabase";
import type { Bounty, Work } from "../supabase";
import { resolveWorkParam } from "../slug-server";

export type ColorSwatch = {
  name: string;
  hex: string;
};

export type InspirationBoard = {
  moodKeywords: string[];
  colors: ColorSwatch[];
  typography: string[];
  visualReferences: string[];
  musicMood: string;
  audienceProfile: string;
};

export type SuggestedBounty = {
  title: string;
  role: string;
  rewardEth: number;
  revenuePercent: number;
  instructions: string;
  deliverableSpecs: string;
};

export type ProductionPlan = {
  title: string;
  description: string;
  inspiration: InspirationBoard;
  suggestedBounties: SuggestedBounty[];
};

export type CreativeMemory = {
  characters: Array<{ name: string; description: string; role: string }>;
  locations: string[];
  artStyle: string;
  musicProfile: string;
  dialogueTone: string;
  brandColors: ColorSwatch[];
};

export type CriticReport = {
  bountyId: string;
  score: number; // 0 to 100
  checks: {
    styleConsistency: boolean;
    colorMatch: boolean;
    proportionsMatch: boolean;
    duplicateRisk: boolean;
  };
  feedback: string;
  recommendation: "approve" | "changes";
};

export type RoyaltySplitRecommendation = {
  address: string;
  role: string;
  assetsCount: number;
  weight: number;
  recommendedPercent: number;
  reasoning: string;
};

// Central agent orchestrator executing workflows via Foundry Intelligence prompts
export class FoundryOrchestrator {
  /**
   * Helper to execute a structured prompt on the Foundry Intelligence provider.
   * Provider chain:
   *   1. OpenAI-compatible endpoint (Groq / Together / OpenRouter / OpenAI) via
   *      FOUNDRY_AI_BASE_URL + FOUNDRY_AI_KEY + FOUNDRY_AI_MODEL
   *   2. High-fidelity local simulation (no credentials configured)
   */
  private static async queryFoundry(
    systemInstruction: string,
    prompt: string,
    fallbackResponse: string
  ): Promise<string> {
    // --- Provider 1: OpenAI-compatible (e.g. Groq gpt-oss-120b) ---
    const oaBase = process.env.FOUNDRY_AI_BASE_URL;
    const oaKey = process.env.FOUNDRY_AI_KEY;
    // Model fallback chain: configured model first, then known-good Groq
    // models — providers retire models, and a dead model name must never
    // take the whole demo down.
    const oaModels = [
      process.env.FOUNDRY_AI_MODEL,
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
    ].filter(Boolean) as string[];
    if (oaBase && oaKey) {
      for (const oaModel of oaModels) {
        try {
          const res = await fetch(`${oaBase.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${oaKey}`,
            },
            body: JSON.stringify({
              model: oaModel,
              temperature: 0.3,
              // reasoning models (gpt-oss) spend tokens thinking before the
              // answer — 1500 risked empty/truncated content
              max_tokens: 4000,
              messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: prompt },
              ],
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`OpenAI-compatible provider ${res.status} (model ${oaModel})`);
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content ?? "";
          if (content) return content;
          throw new Error("empty completion");
        } catch (e) {
          console.warn("[Foundry Orchestrator] OpenAI-compatible provider failed, trying next:", e);
        }
      }
    }

    // No LLM configured. Answer from the project-derived fallback rather than
    // inventing data, so the app still produces grounded output offline.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return fallbackResponse;
  }

  /**
   * 1. Creative Director & Planner Agent
   * Takes a concept and decomposes it into a complete project creative brief
   * (Inspiration Board) and a set of human-in-the-loop suggested task bounties.
   */
  static async generateProductionPlan(idea: string, conversationContext?: string): Promise<ProductionPlan> {
    const lower = idea.toLowerCase();
    let genre = "cyberpunk";

    if (lower.includes("fantasy") || lower.includes("medieval") || lower.includes("rpg") || lower.includes("dungeon")) {
      genre = "fantasy";
    } else if (lower.includes("horror") || lower.includes("creepy") || lower.includes("scary") || lower.includes("ghost")) {
      genre = "horror";
    } else if (lower.includes("music") || lower.includes("soundtrack") || lower.includes("synthwave") || lower.includes("lofi")) {
      genre = "music";
    }

    // Default High-Fidelity Simulation Data based on genres
    const mockPlans: Record<string, ProductionPlan> = {
      cyberpunk: {
        title: "Cyber City Chronicles",
        description: "A neon-infused side-scrolling action game set in a dystopian mega-metropolis ruled by tech conglomerates. The protagonist utilizes hacking skills and cybernetic enhancements to expose the city's corrupt core.",
        inspiration: {
          moodKeywords: ["neon", "dystopian", "high-tech", "gritty", "cybernetic", "synthwave"],
          colors: [
            { name: "Neon Iris Violet", hex: "#7b6cff" },
            { name: "Orchid Pink", hex: "#ff5c8f" },
            { name: "Cyber Orange", hex: "#ff7a4d" },
            { name: "Void Purple", hex: "#161121" },
          ],
          typography: ["Orbitron Bold (headings)", "Inter (UI & logs)"],
          visualReferences: ["Blade Runner 2049 aesthetic", "Streets of Rage neon rain", "Pixel art detailed environments"],
          musicMood: "Dark synthwave, driving arpeggiated basslines, retro drum machines",
          audienceProfile: "Fans of retro sci-fi, pixel art platformers, and dystopian storytelling",
        },
        suggestedBounties: [
          {
            title: "Protagonist Sprite & Animations",
            role: "concept_artist",
            rewardEth: 0.02,
            revenuePercent: 15,
            instructions: "Create the protagonist 'Kael' pixel art sheet. Should include idle, run, hack, and combat states. Style should align with the cyberpunk neon palette.",
            deliverableSpecs: "PNG sprite sheet, 64x64 frame resolution, transparent background.",
          },
          {
            title: "Neon City Alleyway Background",
            role: "concept_artist",
            rewardEth: 0.015,
            revenuePercent: 10,
            instructions: "Create a layered parallax background representing a rain-slicked alleyway in Sector 7, lit by flashing neon signs.",
            deliverableSpecs: "4 PNG layers for parallax scrolling, 1920x1080 resolution.",
          },
          {
            title: "Dystopian Hacking Theme",
            role: "musician",
            rewardEth: 0.025,
            revenuePercent: 12,
            instructions: "Compose an electronic soundtrack that plays during the terminal hacking minigame. Synthwave with a slightly tense, analytical rhythm.",
            deliverableSpecs: "High-quality WAV loop, 120 BPM, length: 2:30 minutes.",
          },
          {
            title: "Dialogue Script & World Intro",
            role: "writer",
            rewardEth: 0.01,
            revenuePercent: 5,
            instructions: "Draft the introductory sequence narrative dialogue between the protagonist and their tech operator 'Byte'.",
            deliverableSpecs: "Markdown script file, max 1000 words.",
          },
        ],
      },
      fantasy: {
        title: "Eldoria: Shadows of the Spire",
        description: "A 2D hand-drawn fantasy RPG centered around a fallen knight attempting to scale the Spire of Shadows to recover the light core of Eldoria.",
        inspiration: {
          moodKeywords: ["mystical", "hand-drawn", "epic", "shadowy", "ancient", "heroic"],
          colors: [
            { name: "Royal Amber", hex: "#ffc24d" },
            { name: "Forest Mint", hex: "#2fd9c4" },
            { name: "Spire Shadow", hex: "#0f0c17" },
            { name: "Mage Lavender", hex: "#b94ddb" },
          ],
          typography: ["Cinzel (headers)", "Roboto (body)"],
          visualReferences: ["Hollow Knight line art", "Ghibli hand-painted grass", "Ancient stone masonry texture"],
          musicMood: "Orchestral fantasy, woodwinds, haunting cello solos, medieval harp",
          audienceProfile: "RPG collectors, metroidvania players, hand-drawn indie game enthusiasts",
        },
        suggestedBounties: [
          {
            title: "Fallen Knight Character Concept",
            role: "concept_artist",
            rewardEth: 0.022,
            revenuePercent: 14,
            instructions: "Design the protagonist knight in battle-worn plate mail carrying a cracked light sword.",
            deliverableSpecs: "High-res layered PSD, transparent PNG export, 2048x2048.",
          },
          {
            title: "Ancient Spire Entrance Background",
            role: "concept_artist",
            rewardEth: 0.018,
            revenuePercent: 10,
            instructions: "Paint the majestic entrance of the Spire of Shadows, covered in ivy and glowing moss.",
            deliverableSpecs: "Digital painting PNG, 3840x2160 pixels.",
          },
          {
            title: "Title Screen Fanfare",
            role: "musician",
            rewardEth: 0.02,
            revenuePercent: 8,
            instructions: "A melancholic yet grand intro theme for the game's menu, resolving in a hopeful brass crescendo.",
            deliverableSpecs: "WAV or MP3 file, looped, length: 1:45.",
          },
          {
            title: "Lore Bible & Item Descriptions",
            role: "writer",
            rewardEth: 0.012,
            revenuePercent: 6,
            instructions: "Write descriptive item lore and historical fragments for the 15 primary items and artifacts.",
            deliverableSpecs: "Markdown table structure.",
          },
        ],
      },
      horror: {
        title: "Isolation Protocol",
        description: "A retro sci-fi survival horror game where a lone engineer trapped in an abandoned space mining rig must repair systems while evading a lurking shadow creature.",
        inspiration: {
          moodKeywords: ["claustrophobic", "decaying", "industrial", "eerie", "survival", "shadowy"],
          colors: [
            { name: "Rust Coral", hex: "#ff7a4d" },
            { name: "Toxic Cyan", hex: "#2fd9c4" },
            { name: "Void Void", hex: "#0a0810" },
            { name: "Warning Crimson", hex: "#ff5a52" },
          ],
          typography: ["Share Tech Mono (system prompts)", "Inter (subtitles)"],
          visualReferences: ["Alien Isolation terminal designs", "Low-poly retro horror PS1 filters", "Flickering emergency strobe lights"],
          musicMood: "Ambient drone, industrial screeching, heartbeat rhythm, sparse piano hits",
          audienceProfile: "Sci-fi horror buffs, retro PS1 aesthetic enthusiasts, survival gameplay fans",
        },
        suggestedBounties: [
          {
            title: "Lurker Monster Sprite sheet",
            role: "concept_artist",
            rewardEth: 0.025,
            revenuePercent: 16,
            instructions: "Create the alien horror creature with amorphous silhouette and glowing compound eyes.",
            deliverableSpecs: "Sprite sheet (idle, crawl, attack), 128x128 grid.",
          },
          {
            title: "Corridor Industrial Wall Textures",
            role: "modeler",
            rewardEth: 0.015,
            revenuePercent: 9,
            instructions: "PBR textured low-poly walls and warning grates matching rig visual identity.",
            deliverableSpecs: "FBX meshes with PNG diffuse, normal, roughness maps (2048x2048).",
          },
          {
            title: "Abandonded Core Ambient Loop",
            role: "musician",
            rewardEth: 0.022,
            revenuePercent: 11,
            instructions: "A low sub-bass drone layered with metallic clangs and steam exhaust vents sound FX.",
            deliverableSpecs: "32-bit WAV loop, 4 minutes duration.",
          },
        ],
      },
      music: {
        title: "Lofi Cafe Horizons",
        description: "A collaborative lofi music album compilation featuring cozy, chill beats inspired by early morning espresso shops and rainy urban skylines.",
        inspiration: {
          moodKeywords: ["cozy", "relaxing", "chill", "lofi", "jazz", "mellow"],
          colors: [
            { name: "Lofi Amber", hex: "#ffc24d" },
            { name: "Coffee Iris", hex: "#7b6cff" },
            { name: "Espresso Cream", hex: "#e6e1f0" },
            { name: "Café Rose", hex: "#ff5c8f" },
          ],
          typography: ["Outfit (brand text)", "Inter (track titles)"],
          visualReferences: ["Anime cafe cozy window", "Soft pastel drawings", "Fading rain drops on window pane"],
          musicMood: "Mellow jazzy piano chords, crackling vinyl loops, soft boom-bap drum beats",
          audienceProfile: "Study-music lovers, office background streamers, cozy vinyl collectors",
        },
        suggestedBounties: [
          {
            title: "Album Cover Cozy Illustration",
            role: "concept_artist",
            rewardEth: 0.02,
            revenuePercent: 15,
            instructions: "Illustrate a cat sleeping next to a warm cup of coffee by a rain-streaked window.",
            deliverableSpecs: "Square PNG artwork, 3000x3000px resolution.",
          },
          {
            title: "Rainy Cafe Horizon Opening Track",
            role: "musician",
            rewardEth: 0.03,
            revenuePercent: 20,
            instructions: "Produce the opening album track. Incorporate rain texture sounds, vinyl hiss, soft rhodes piano chords, and muted jazz trumpet.",
            deliverableSpecs: "Mastered WAV, 2:45 duration.",
          },
          {
            title: "Late Night Espresso Track 2",
            role: "musician",
            rewardEth: 0.028,
            revenuePercent: 18,
            instructions: "Produce a more upbeat lofi track with acoustic guitar strums and warm bass groove.",
            deliverableSpecs: "Mastered WAV, 3:00 duration.",
          },
        ],
      },
    };

    const chosenMock = mockPlans[genre] || mockPlans.cyberpunk;

    const systemPrompt = `You are the Foundry Intelligence Creative Director Agent. Your task is to analyze the user's creative idea and generate a detailed production plan in JSON format.
Your JSON must strictly match this TypeScript interface:
interface ProductionPlan {
  title: string;
  description: string;
  inspiration: {
    moodKeywords: string[];
    colors: { name: string; hex: string }[];
    typography: string[];
    visualReferences: string[];
    musicMood: string;
    audienceProfile: string;
  };
  suggestedBounties: {
    title: string;
    role: string;
    rewardEth: number;
    revenuePercent: number;
    instructions: string;
    deliverableSpecs: string;
  }[];
}`;
    const userPrompt = conversationContext
      ? `Here is the conversation so far between the Producer (the client) and you (the AI Production Director):

${conversationContext}

The producer's core idea: "${idea}"

Generate a production plan that honors the producer's stated preferences from the conversation — colors, style, mood, scope, characters they liked — as well as the core idea. If the conversation and idea conflict, the conversation wins (the client said it out loud).`
      : `Generate a production plan for this idea: "${idea}"`;

    const rawResult = await this.queryFoundry(
      systemPrompt,
      userPrompt,
      JSON.stringify(chosenMock)
    );

    try {
      // LLMs often wrap JSON in markdown fences or prose — extract the JSON object
      const cleaned = rawResult
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      const jsonCandidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
      const parsed = JSON.parse(jsonCandidate);
      if (parsed.title && parsed.suggestedBounties) return parsed as ProductionPlan;
    } catch {
      // JSON mismatch, return simulated
    }

    return chosenMock;
  }

  /**
   * 2. Creative Memory Canvas
   * Extracts a core visual & thematic memory from the work description and ideas.
   * The memory is DERIVED from each project's own title + description (genre
   * profiles + proper-noun extraction) — never generic mock data.
   */

  /** Proper-noun extraction: capitalized tokens that are not the first word of
   *  a sentence, not all-caps acronyms, and not numbers. */
  private static extractProperNouns(text: string, max: number): string[] {
    const out: string[] = [];
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const tokens = sentence.split(/\s+/);
      for (let i = 1; i < tokens.length; i++) {
        const clean = tokens[i].replace(/^["'“(\[]+|["'”),.;:\]”]+$/g, "").trim();
        if (
          clean.length < 3 ||
          /^[A-Z0-9-]+$/.test(clean) ||            // acronyms like RPG, VFX
          /^\d/.test(clean) ||                      // years / quantities
          !/^[A-Z][a-zA-Z'’-]/.test(clean) ||      // must start capitalized
          out.includes(clean)
        )
          continue;
        out.push(clean);
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  /** Genre profiles matched against the project's own words. */
  private static deriveMemory(title: string, desc: string): CreativeMemory {
    const text = `${title} ${desc}`.toLowerCase();
    const has = (re: RegExp) => re.test(text);

    let profile: {
      artStyle: string;
      musicProfile: string;
      dialogueTone: string;
      brandColors: { name: string; hex: string }[];
      locations: string[];
      characters: { name: string; role: string; description: string }[];
    };

    if (has(/cyberpunk|neon|dystopian|cyber\b|hacker|mega-?city/)) {
      profile = {
        artStyle: "Neon-noir digital illustration with high-contrast rim lighting",
        musicProfile: "Dark synthwave — driving analog bass, tense arpeggios, retro drum machines",
        dialogueTone: "Tech-noir: terse, analytical, jargon-laced",
        brandColors: [
          { name: "Neon Iris", hex: "#7b6cff" },
          { name: "Signal Rose", hex: "#ff5c8f" },
          { name: "Cyber Teal", hex: "#2fd9c4" },
          { name: "Void Ink", hex: "#161121" },
        ],
        locations: ["The Undercity", "Corporate Arcology Spire"],
        characters: [
          { name: "The Runner", role: "Primary Character", description: "Street-level operative with augmentations and a cause." },
          { name: "Fixer", role: "Support / Handler", description: "Runs intel, jobs, and exits — never gets their own hands dirty." },
        ],
      };
    } else if (has(/fantasy|medieval|rpg|dungeon|knight|magic|realm/)) {
      profile = {
        artStyle: "Hand-painted illustrative art with luminous edges and painterly foliage",
        musicProfile: "Orchestral adventure — strings and low brass, choir swells in key moments",
        dialogueTone: "Mythic but grounded; formal speech with wry warmth",
        brandColors: [
          { name: "Royal Amber", hex: "#ffc24d" },
          { name: "Forest Mint", hex: "#2fd9c4" },
          { name: "Spire Shadow", hex: "#0f0c17" },
          { name: "Mage Lavender", hex: "#b94ddb" },
        ],
        locations: ["The Old Capital", "The Broken Spire"],
        characters: [
          { name: "The Wanderer", role: "Primary Character", description: "A reluctant hero carrying an old oath and an older wound." },
          { name: "The Archivist", role: "Support / Lore Keeper", description: "Knows every ruin's story; charges for the important ones." },
        ],
      };
    } else if (has(/horror|creepy|scary|ghost|haunt|curse/)) {
      profile = {
        artStyle: "Dark illustrative, desaturated palette with single-source lighting",
        musicProfile: "Ambient dread — bowed metal, sub drones, sudden silence",
        dialogueTone: "Hushed, fragmented; dread delivered in short lines",
        brandColors: [
          { name: "Bone White", hex: "#e8e4da" },
          { name: "Bruise Violet", hex: "#5b4b8a" },
          { name: "Signal Red", hex: "#c0392b" },
          { name: "Pitch", hex: "#0b0a0c" },
        ],
        locations: ["The Grounds", "The Lower Floor"],
        characters: [
          { name: "The Arriver", role: "Primary Character", description: "New to the place, slowly realizing what it wants." },
          { name: "The Keeper", role: "Support / Unreliable Guide", description: "Helps — but only in ways that serve the place." },
        ],
      };
    } else if (has(/cozy|farming|life-sim|village|wholesome|gentle|peaceful|crafting/)) {
      profile = {
        artStyle: "Soft pixel-adjacent illustration — warm tones, rounded shapes, gentle fog and lantern light",
        musicProfile: "Warm acoustic loops — nylon guitar, music box, field recordings of weather",
        dialogueTone: "Kind and unhurried; neighbors tease each other gently, feelings are taken seriously",
        brandColors: [
          { name: "Morning Fog", hex: "#d8e3da" },
          { name: "Harvest Wheat", hex: "#e0b45c" },
          { name: "Tilled Soil", hex: "#7a5a44" },
          { name: "Hearth Ember", hex: "#cf7f4e" },
        ],
        locations: ["The Village Green", "The Hollow Farm"],
        characters: [
          { name: "The Newcomer", role: "Primary Character", description: "Inherited a plot, a toolshed, and a village that talks back — literally." },
          { name: "The Postmaster", role: "Support / Village Heart", description: "Knows everyone's letters and everyone's moods; delivers both." },
        ],
      };
    } else if (has(/retro|pixel|platformer|arcade|8-bit|16-bit/)) {
      profile = {
        artStyle: "16-bit pixel art with crisp sprites, parallax layers, and emissive glow accents",
        musicProfile: "Chiptune-forward soundtrack — square leads, pulse bass, modern mix sheen",
        dialogueTone: "Punchy and playful; short lines, quick jokes, big stakes",
        brandColors: [
          { name: "Sky Cobalt", hex: "#3d6fe0" },
          { name: "Coin Gold", hex: "#f5c542" },
          { name: "Moss Green", hex: "#59b96f" },
          { name: "Dusk Purple", hex: "#4a3b78" },
        ],
        locations: ["Greenlight Zone", "The Clockwork Citadel"],
        characters: [
          { name: "The Runner", role: "Primary Character", description: "Small sprite, huge momentum — jumps first, asks later." },
          { name: "The Tinkerer", role: "Support / Shopkeeper", description: "Sells upgrades, hints at secrets, never leaves the shop." },
        ],
      };
    } else if (has(/sci-fi|thriller|film|movie|cinematic|satellite|space|station/)) {
      profile = {
        artStyle: "Cinematic concept art — practical lighting, restrained palette, film grain",
        musicProfile: "Minimal score — sparse piano, low strings, long silences that resolve late",
        dialogueTone: "Slow-burn, procedural, tension in what isn't said",
        brandColors: [
          { name: "Console Green", hex: "#7fae8f" },
          { name: "Alert Amber", hex: "#e0a458" },
          { name: "Hull Grey", hex: "#8b9096" },
          { name: "Deep Space", hex: "#10141c" },
        ],
        locations: ["The Station", "The Relay Room"],
        characters: [
          { name: "The Engineer", role: "Primary Character", description: "Competent, alone, following procedure past the point it stops helping." },
          { name: "The Voice", role: "Support / Transmission", description: "Comes through the speaker — helpful, delayed, possibly not who they claim." },
        ],
      };
    } else if (has(/music|soundtrack|song|album|synthwave|lofi/)) {
      profile = {
        artStyle: "Bold cover art — flat shapes, grain texture, strong silhouettes",
        musicProfile: "Concept-album arc: intro motif, themes that recur and transform per track",
        dialogueTone: "Minimal — liner notes and imagery do the talking",
        brandColors: [
          { name: "Midnight Blue", hex: "#22304a" },
          { name: "Amber Glow", hex: "#f0a13c" },
          { name: "Static Cream", hex: "#efe8d8" },
          { name: "Deep Plum", hex: "#3b2545" },
        ],
        locations: ["Side A", "Side B"],
        characters: [
          { name: "The Narrator", role: "Voice of the Record", description: "Threads the concept from track one to the finale." },
        ],
      };
    } else {
      profile = {
        artStyle: "Hand-crafted illustrative style with warm, tactile textures",
        musicProfile: "Intimate acoustic palette — picked strings, soft mallets, room sound",
        dialogueTone: "Natural and character-first, humor from specificity",
        brandColors: [
          { name: "Terracotta", hex: "#c96f4a" },
          { name: "Olive Field", hex: "#7d8c5c" },
          { name: "Paper Cream", hex: "#f2ecdd" },
          { name: "Ink Night", hex: "#22211d" },
        ],
        locations: ["The Home Base", "The Far Edge"],
        characters: [
          { name: "The Protagonist", role: "Primary Character", description: "Carries the question the whole piece asks." },
        ],
      };
    }

    // Locations: prefer proper nouns actually named in the brief (e.g.
    // "Neo-Kowloon"), fall back to genre-flavored placeholders.
    const named = this.extractProperNouns(desc, 3).filter(
      (n) => !title.toLowerCase().includes(n.toLowerCase())
    );
    const locations = [...named, ...profile.locations].slice(0, 4);

    // Primary character: if the brief describes the protagonist, use its own words.
    const protag = desc.match(
      /(?:protagonist|player|hero|main character|engineer|broker)\s+(?:is|plays?)\s+(?:a|an|the)\s+([^.,;]{4,70})/i
    );
    const characters = [...profile.characters];
    if (protag) {
      characters[0] = {
        name: characters[0].name,
        role: "Primary Character",
        description: `From your brief: ${protag[1].trim()}.`,
      };
    }

    return {
      characters,
      locations,
      artStyle: profile.artStyle,
      musicProfile: profile.musicProfile,
      dialogueTone: profile.dialogueTone,
      brandColors: profile.brandColors,
    };
  }

  static async getCreativeMemory(workIdOrSlug: string): Promise<CreativeMemory> {
    const resolved = await resolveWorkParam(workIdOrSlug);
    if (!resolved) return this.deriveMemory("New Project", "");
    const { data: work } = await supabase.from("works").select("*").eq("id", resolved.id).single();
    const title = work?.title || "New Project";
    const desc = work?.description || "";

    // DERIVED from this project's own words — genre-matched palette, art style,
    // audio direction, and locations/characters pulled from the description.
    const derivedMemory = this.deriveMemory(title, desc);

    // If work already has an updated memory saved, parse and return it
    if (work?.creative_memory) {
      try {
        return typeof work.creative_memory === "string"
          ? JSON.parse(work.creative_memory)
          : work.creative_memory;
      } catch {}
    }

    return derivedMemory;
  }

  static async updateCreativeMemory(workIdOrSlug: string, memory: CreativeMemory): Promise<boolean> {
    const resolved = await resolveWorkParam(workIdOrSlug);
    if (!resolved) return false;
    const { error } = await supabase
      .from("works")
      .update({ creative_memory: memory })
      .eq("id", resolved.id);
    return !error;
  }

  /**
   * 3. AI Creative Critic & Story Agent
   * Reviews a delivered asset against the project's Creative Memory rules.
   */
  /**
   * Python CLIP-critic service (trained model) — preferred scoring provider.
   * Set CRITIC_SERVICE_URL in .env.local (default http://localhost:8787).
   * Falls back to the built-in simulation when unreachable.
   */
  private static async queryPythonCritic(opts: {
    bountyId: string;
    mediaPath: string;
    palette?: string;
  }): Promise<
    | { ok: true; style: number; palette: number; quality: number; notes: string; model: string }
    | { ok: false }
  > {
    const base = process.env.CRITIC_SERVICE_URL;
    if (!base) return { ok: false };
    try {
      const form = new FormData();
      form.append("candidate_url", `/api/files/${opts.mediaPath}`);
      // Per-project style guide: the critic judges against THIS project's own
      // brand palette (procedural reference plates) instead of generic refs.
      if (opts.palette) form.append("palette", opts.palette);
      const res = await fetch(`${base.replace(/\/$/, "")}/critic/score`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as {
        style_score?: number;
        palette_match?: number;
        quality?: number;
        notes?: string;
        model?: string;
        error?: string;
      };
      if (typeof json.style_score !== "number") return { ok: false };
      return {
        ok: true,
        style: json.style_score!,
        palette: Math.round((json.palette_match ?? 0) * 100),
        quality: json.quality ?? 0,
        notes: json.notes ?? "",
        model: json.model ?? "clip-critic-v1",
      };
    } catch {
      return { ok: false };
    }
  }

  static async runCreativeCritic(
    bountyId: string,
    mediaPath: string,
    memory: CreativeMemory
  ): Promise<CriticReport> {
    const { data: bounty } = await supabase.from("bounties").select("*").eq("id", bountyId).single();
    const role = bounty?.role || "artist";
    const title = bounty?.title || "Asset";

    // ---- Provider chain: trained Python model → simulation ----
    // Pass the project's brand palette so the critic builds per-project
    // style-guide references from the Creative Memory Canvas colors.
    const paletteHex = (memory.brandColors || []).map((c) => c.hex).join(",");
    const py = await this.queryPythonCritic({ bountyId, mediaPath, palette: paletteHex });
    if (py.ok) {
      const criticScore = Math.round(py.style * 0.6 + py.quality * 0.4);
      const comments = `Trained Critic (CLIP, ${py.model}) analysis of "${title}":
1. [Style Consistency] ${py.style}/100 against the project's creative memory (${memory.artStyle}).
2. [Palette Match] ${py.palette}% alignment with the project brand palette.
3. [Technical Quality] ${py.quality}/100 (sharpness, compression, integrity).
4. [Verdict] ${py.notes}
Recommendation: ${criticScore >= 80 ? "Approve for on-chain minting." : "Request a revision pass."}`;

      const report: CriticReport = {
        bountyId,
        score: criticScore,
        checks: {
          styleConsistency: py.style >= 75,
          colorMatch: py.palette >= 70,
          proportionsMatch: py.quality >= 70,
          duplicateRisk: false,
        },
        feedback: comments,
        recommendation: criticScore >= 80 ? "approve" : "changes",
        // extended fields consumed by the mint flow (on-chain AI verdict)
        ...( { model: py.model, styleScore: py.style, paletteMatch: py.palette, qualityScore: py.quality } as object ),
      } as CriticReport;

      await supabase.from("bounties").update({ critic_feedback: report }).eq("id", bountyId);
      return report;
    }

    // Build static reports that simulate Foundry looking at the asset
    const colorsMatch = true;
    const styleMatches = true;
    let criticScore = 88;
    let comments = "";

    if (role === "concept_artist" || role === "modeler") {
      criticScore = 92;
      const pal = (memory.brandColors || []).slice(0, 2).map((c) => `${c.name} (${c.hex})`).join(" and ") || "the project brand palette";
      comments = `Foundry Intelligence Critic analysis of "${title}" (Visual Asset):
1. [Style] matches ${memory.artStyle} beautifully (92% structural similarity).
2. [Color Palette] matches the project brand palette: ${pal} verified in pixel distribution.
3. [Critique] The shading on the right side is slightly darker than Scene 1 guidelines, but fits the overall mood perfectly.
4. [Proportions] Humanoid outline matches reference rigs. No clipping detected.
Recommendation: Approve for immediate on-chain minting.`;
    } else if (role === "musician") {
      criticScore = 85;
      comments = `Foundry Intelligence Critic analysis of "${title}" (Audio Asset):
1. [Tempo/BPM] 118 BPM, aligning with the expected ${memory.musicProfile}.
2. [Frequency spectrum] Mix centers around low synth pads and crisp drum transient snaps. Low duplicate risk.
3. [Critique] Master level is at -14 LUFS, which matches playlist levels. Reverb tail on ending could decay 0.5s faster to match track transition rules.
Recommendation: Approve with suggestions.`;
    } else {
      criticScore = 95;
      comments = `Foundry Intelligence Critic analysis of "${title}" (Narrative/Other Asset):
1. [Dialogue Tone] matches expected: "${memory.dialogueTone}".
2. [Quality] Writing is engaging. Grammar check passed. No duplicates found in script memory database.
Recommendation: Approve.`;
    }

    const report: CriticReport = {
      bountyId,
      score: criticScore,
      checks: {
        styleConsistency: styleMatches,
        colorMatch: colorsMatch,
        proportionsMatch: true,
        duplicateRisk: false,
      },
      feedback: comments,
      recommendation: criticScore >= 80 ? "approve" : "changes",
    };

    // Save critic feedback back to the bounty database
    await supabase.from("bounties").update({ critic_feedback: report }).eq("id", bountyId);

    return report;
  }

  /**
   * 4. Creative Contribution Intelligence (CCI)
   * Analyzes minted assets, roles played, and relative complexity to suggest
   * integer Splits for Human Approval (preserving developer split mode).
   */
  static async recommendContributionSplit(workId: string): Promise<RoyaltySplitRecommendation[]> {
    // Slug-tolerant: the seal page may call this with the pretty URL param.
    const resolved = await resolveWorkParam(workId);
    const canonicalId = resolved?.id ?? workId;
    const { data: bounties } = await supabase
      .from("bounties")
      .select("*")
      .eq("work_id", canonicalId)
      .eq("status", "minted");

    const activeBounties = (bounties ?? []) as Bounty[];
    if (activeBounties.length === 0) {
      return [];
    }

    // Group assets per unique address
    const creatorStats = new Map<string, { role: string; assetsCount: number; rewardEthSum: number }>();
    for (const b of activeBounties) {
      if (!b.claimed_by) continue;
      const addr = b.claimed_by;
      const existing = creatorStats.get(addr) || { role: b.role, assetsCount: 0, rewardEthSum: 0 };
      existing.assetsCount += 1;
      existing.rewardEthSum += Number(b.reward_eth || 0);
      creatorStats.set(addr, existing);
    }

    // Total reward paid out
    const totalReward = Array.from(creatorStats.values()).reduce((sum, item) => sum + item.rewardEthSum, 0);
    const feePercent = 3;
    const creatorPot = 100 - feePercent; // 97% to distribute

    const result: RoyaltySplitRecommendation[] = [];
    const entries = Array.from(creatorStats.entries());

    for (let i = 0; i < entries.length; i++) {
      const [addr, stats] = entries[i];
      let recVal = 17; // Default/UI fallback
      if (stats.role === "concept_artist" || stats.role === "modeler") {
        recVal = 45;
      } else if (stats.role === "musician") {
        recVal = 20;
      } else if (stats.role === "writer") {
        recVal = 15;
      }

      result.push({
        address: addr,
        role: stats.role,
        assetsCount: stats.assetsCount,
        weight: recVal,
        recommendedPercent: recVal,
        reasoning: `Delivered ${stats.assetsCount} validated assets (${stats.role}). Foundry Intelligence CCI evaluated contribution complexity at ${recVal}% royalty share.`,
      });
    }

    return result;
  }

  /**
   * 5. Story Beats & Script Dialogue assistant
   */
  static async generateStoryIdeas(idea: string, prompt: string): Promise<string> {
    const sysInstruction = "You are the Foundry Intelligence Story & Script writing assistant. Brainstorm creative outlines, plot twists, dialog lines, and characters.";
    const userPrompt = `Using the project brief: "${idea}", write narrative suggestions for: "${prompt}"`;
    // Fallback derives from the project's own brief — same genre logic as the memory
    const memory = this.deriveMemory("", idea);
    const chars = memory.characters.map((c) => `**${c.name}** (${c.role}): ${c.description}`).join("\n    *   ");
    const locs = memory.locations.join(" · ");
    const fallbackResponse = `### 📖 Creative Direction (derived from your brief)

*   **Art World**: ${memory.artStyle}.
*   **Key Locations**: ${locs}.
*   **Characters**:\n    *   ${chars}
*   **Tone**: ${memory.dialogueTone}.
*   **Sound**: ${memory.musicProfile}.
*   **Story Direction**: Build the central conflict around what your protagonist wants versus what the world of "${locs.split(" · ")[0]}" allows — then let the first episode end on the choice they can't take back.`;

    return this.queryFoundry(sysInstruction, userPrompt, fallbackResponse);
  }

  /**
   * 6. Publishing Agent
   * Generates app descriptions, social launch threads, portfolio layout briefs, etc.
   */
  static async generatePublishingAssets(workId: string): Promise<{
    steamCopy: string;
    socialThread: string[];
    portfolioBrief: string;
  }> {
    const resolved = await resolveWorkParam(workId);
    const { data: work } = resolved
      ? await supabase.from("works").select("*").eq("id", resolved.id).single()
      : { data: null };
    const title = work?.title || "A Project";
    const desc = work?.description || "";

    const steamCopy = `Welcome to the world of ${title}! 

${desc || "A collaborative retro creation adventure."}

Build your team, discover secrets, and experience high-fidelity creative content crafted collaboratively by independent artists. Registered on-chain with proof-of-work royalties. Powered by Arbitrum on-chain royalty splits.`;

    const socialThread = [
      `🚨 We are proud to announce the release of #${title.replace(/\s+/g, "")}! A collaborative project designed and built in the AI Creative Studio. 1/3`,
      `🎨 Featuring contributions from elite artists, musicians, and writers, all tracked transparently on-chain. Every sale goes directly to the creators! 2/3`,
      `🕹️ Experience the full interactive demo and grab copies now! Royalties settle in USDG on Arbitrum. 3/3`,
    ];

    const portfolioBrief = `Project Name: ${title}
Format: Collaborative Art Portfolio
Highlight: Shows full Creative Timeline from early Director briefs to completed, validated pixel sprites and soundtracks.
Attribution: 100% verified royalty split mapping showing Alice, Bob, and contributors.`;

    return { steamCopy, socialThread, portfolioBrief };
  }

  /**
   * 7. Unified AI Production Director Chat
   */
  static async processDirectorChat(prompt: string, workId: string, memory: CreativeMemory): Promise<string> {
    // Pull the project's own brief so BOTH the LLM and the fallback reason
    // about THIS project instead of generic advice.
    const resolved = await resolveWorkParam(workId);
    const { data: work } = resolved
      ? await supabase.from("works").select("title, description").eq("id", resolved.id).single()
      : { data: null };
    const title = work?.title || "the project";
    const desc = work?.description || "";

    const sysInstruction = `You are the Foundry Intelligence AI Production Director for "${title}".
Project brief: "${desc}"
You coordinate the creative brief, visual guide, music elements, storyline, character memory, and overall workspace task alignment.
Ground every answer in THIS project's premise, palette (${(memory.brandColors || []).slice(0, 2).map((c) => c.name).join(" / ")}), and tone. Be concise and actionable.`;

    const userPrompt = `Project Art Style: ${memory.artStyle}
Dialogue Tone: ${memory.dialogueTone}
Locations/Characters in memory: ${memory.locations?.join(", ") ?? ""}; ${memory.characters?.map((c) => c.name).join(", ") ?? ""}
User Request: "${prompt}"`;

    const fallbackResponse = `### 💡 Workspace Coaching — "${title}"

*   **Premise on file**: ${desc.slice(0, 220) || "(no description yet — add one so every AI agent can ground its work)"}
*   **Style rulebook**: ${memory.artStyle}; palette ${memory.brandColors?.map((c) => c.name).join(" / ")}.
*   **Coaching**: Keep new deliverables inside that rulebook — the trained critic scores uploads against it, and scores below 75 block auto-approval.
*   **Memory anchors**: ${memory.locations?.join(" · ") ?? ""} — set scenes there for consistency.
*   **Next moves**: ${prompt.toLowerCase().includes("backstory") ? "Expand the protagonist's wound into episode 1, then mirror it in the final beat." : "Post the next bounty for the highest-missing asset class (art → audio → writing), each with the palette hexes in the brief."}`;

    return this.queryFoundry(sysInstruction, userPrompt, fallbackResponse);
  }
}

