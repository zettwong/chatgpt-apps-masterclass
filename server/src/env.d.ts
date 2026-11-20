// Secrets are not in wrangler.jsonc, so `wrangler types` only sees them when
// .dev.vars exists. Declaring the secret here keeps `env.API_KEY` typed either way.
interface Env {
	API_KEY: string;
}
