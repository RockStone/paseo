import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeHeaderButtons } from "./client/badges";

export default function contribute(client: PluginClientContext) {
  return contributeHeaderButtons(client);
}
