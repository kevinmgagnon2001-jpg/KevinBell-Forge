export type ResidentId = "gemma-3-270m" | "gemma-4-e2b" | "qwen-0.5b" | "spark-x2.5-4b";

export type ResidentSpec = {
  id: ResidentId;
  label: string;
  short: string;
  family: "Gemma" | "Qwen" | "Spark";
  repo: string;
  file: string;
  place: "in situ";
  size: string;
  blurb: string;
  /** Selected and powered when the page opens. */
  outOfTheBox: boolean;
};

export const RESIDENT_MODELS: readonly ResidentSpec[] = [
  {
    id: "gemma-3-270m",
    label: "Gemma 3 270M",
    short: "Gemma",
    family: "Gemma",
    repo: "unsloth/gemma-3-270m-it-GGUF",
    file: "gemma-3-270m-it-Q4_0.gguf",
    place: "in situ",
    size: "242 MB",
    blurb: "Google Gemma, running in this page.",
    outOfTheBox: true,
  },
  {
    id: "gemma-4-e2b",
    label: "Gemma 4 E2B",
    short: "Gemma 4",
    family: "Gemma",
    repo: "unsloth/gemma-4-E2B-it-GGUF",
    file: "gemma-4-E2B-it-Q4_0.gguf",
    place: "in situ",
    size: "3.0 GB",
    blurb: "Larger Gemma. The weights download into this page.",
    outOfTheBox: false,
  },
  {
    id: "qwen-0.5b",
    label: "Qwen 2.5 0.5B",
    short: "Qwen",
    family: "Qwen",
    repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    file: "qwen2.5-0.5b-instruct-q4_0.gguf",
    place: "in situ",
    size: "429 MB",
    blurb: "A different model, same tools, still in this page.",
    outOfTheBox: false,
  },
  {
    id: "spark-x2.5-4b",
    label: "Spark-X2.5-4B",
    short: "Spark",
    family: "Spark",
    repo: "PollardWeights/Spark-X2.5-4B-Pollard",
    file: "Spark-X2.5-4B-Pollard-IQ3_S.gguf",
    place: "in situ",
    size: "1.9 GB",
    blurb: "Spark-X2.5 4B. The 2.6 GB file downloads but never starts here, so this is the build this page can open.",
    outOfTheBox: false,
  },
];

export const DEFAULT_RESIDENT_ID: ResidentId = "gemma-3-270m";

export function residentById(id: string): ResidentSpec {
  return RESIDENT_MODELS.find((model) => model.id === id) ?? RESIDENT_MODELS[0];
}

export function isResidentId(id: unknown): id is ResidentId {
  return RESIDENT_MODELS.some((model) => model.id === id);
}
