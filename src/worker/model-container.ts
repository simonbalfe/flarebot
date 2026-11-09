import { Container } from "@cloudflare/containers";

export class ModelContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "10m";
}
