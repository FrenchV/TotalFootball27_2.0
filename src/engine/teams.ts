import { PlayStyle, PressStyle } from "./types";

export type TeamConfig = {
  id: string;
  name: string;
  color: string;
  secondaryColor: string;
  formation: string;
  playStyle: PlayStyle;
  pressStyle: PressStyle;
};

export const TEAMS: TeamConfig[] = [
  {
    id: "esp",
    name: "Spain",
    color: "#1a3f9e",
    secondaryColor: "#d90e21",
    formation: "4-3-3",
    playStyle: "POSSESSION",
    pressStyle: "HIGH_PRESS",
  },
  {
    id: "eng",
    name: "England",
    color: "#c8102e",
    secondaryColor: "#FFFFFF",
    formation: "4-2-3-1",
    playStyle: "DIRECT",
    pressStyle: "MID_BLOCK",
  },
  {
    id: "ger",
    name: "Germany",
    color: "#DDDDDD",
    secondaryColor: "#000000",
    formation: "4-3-3",
    playStyle: "BALANCED",
    pressStyle: "HIGH_PRESS",
  },
  {
    id: "fra",
    name: "France",
    color: "#002395",
    secondaryColor: "#ED2939",
    formation: "4-2-3-1",
    playStyle: "COUNTER",
    pressStyle: "MID_BLOCK",
  },
  {
    id: "bra",
    name: "Brazil",
    color: "#009c3b",
    secondaryColor: "#FFDF00",
    formation: "4-2-3-1",
    playStyle: "BALANCED",
    pressStyle: "MID_BLOCK",
  },
  {
    id: "mar",
    name: "Morocco",
    color: "#C1272D",
    secondaryColor: "#006233",
    formation: "4-5-1",
    playStyle: "COUNTER",
    pressStyle: "LOW_BLOCK",
  },
  {
    id: "arg",
    name: "Argentina",
    color: "#74acdf",
    secondaryColor: "#FFFFFF",
    formation: "4-3-3",
    playStyle: "POSSESSION",
    pressStyle: "MID_BLOCK",
  },
  {
    id: "ita",
    name: "Italy",
    color: "#003087",
    secondaryColor: "#FFFFFF",
    formation: "4-3-3",
    playStyle: "BALANCED",
    pressStyle: "MID_BLOCK",
  },
  {
    id: "ned",
    name: "Netherlands",
    color: "#FF6600",
    secondaryColor: "#FFFFFF",
    formation: "4-3-3",
    playStyle: "POSSESSION",
    pressStyle: "HIGH_PRESS",
  },
  {
    id: "por",
    name: "Portugal",
    color: "#006600",
    secondaryColor: "#FF0000",
    formation: "4-2-3-1",
    playStyle: "DIRECT",
    pressStyle: "MID_BLOCK",
  },
];
