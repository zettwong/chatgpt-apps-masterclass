import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp';
import { z } from 'zod';

const WIDGET_URI = 'ui://flashcards-widget';

// The widget's built JS/CSS are loaded from here (see `base` in widgets/vite.config.ts).
const WIDGET_DOMAIN = 'https://server.tlswjd890.workers.dev';

// What the model sends for each card. `status` is not here: every new card
// starts as 'new', and only the server changes it.
const cardInputSchema = z.object({
	front: z.string().min(1).describe('The question or prompt'),
	back: z.string().min(1).describe('The answer'),
	hint: z.string().describe('A hint for the card'),
});

const deckInputSchema = z.object({
	title: z.string().min(1).describe("The title of the deck. e.g. 'React Fundamentals'"),
	description: z.string().describe('Brief description of what this deck covers.'),
	cards: z.array(cardInputSchema).min(10).max(20).describe('Array of flashcards (aim for 20).'),
});

const usernameSchema = z
	.string()
	.trim()
	.min(1)
	.max(50)
	.describe("The user's username. Ask for this before using the tool");

const deckIdSchema = z.string().min(1).describe('The ID of the deck (starts with "deck-"). Get it from the `list-decks` tool.');

// What is saved in KV: the model's input plus fields the server adds.
type CardStatus = 'new' | 'learning' | 'mastered';
type Card = z.infer<typeof cardInputSchema> & { id: string; status: CardStatus };
type Deck = {
	id: string;
	title: string;
	description: string;
	cards: Card[];
	createdAt: string;
};

// "Zett" and "zett " should be the same user. Encoding keeps a ':' in the
// name from mixing into the key structure.
function userKey(username: string) {
	return `user:${encodeURIComponent(username.trim().toLowerCase())}`;
}

function countMastered(deck: Deck) {
	return deck.cards.filter((card) => card.status === 'mastered').length;
}

function deckNotFound(deckId: string) {
	return {
		content: [{ type: 'text' as const, text: `Deck ${deckId} not found. Call \`list-decks\` to see the user's deck IDs.` }],
		isError: true,
	};
}

function createServer(env: Env) {
	const kv = env.FLASHCARDS_KV;

	const server = new McpServer({
		name: 'Flashcard Server',
		version: '1.0',
	});

	registerAppResource(server, 'Flashcard Widget', WIDGET_URI, { description: 'Flashcard Widget' }, async () => {
		const html = await env.ASSETS.fetch(new URL('http://hello/index.html'));
		return {
			contents: [
				{
					uri: WIDGET_URI,
					text: await html.text(),
					mimeType: RESOURCE_MIME_TYPE,
					_meta: {
						ui: {
							csp: {
								// Only our own Worker, not every *.workers.dev site on the internet.
								connectDomains: [WIDGET_DOMAIN],
								resourceDomains: [WIDGET_DOMAIN, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
							},
						},
					},
				},
			],
		};
	});

	// create deck
	registerAppTool(
		server,
		'create-deck',
		{
			title: 'Create Deck',
			description:
				'Use this to create a deck of flashcards for studying. Generate 20 cards, each with a front (question), a back (answer) and a hint. Ask the user for their username before using this tool.',
			inputSchema: z.object({
				username: usernameSchema,
				deck: deckInputSchema,
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
			},
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Creating your deck...',
				'openai/toolInvocation/invoked': 'Deck created.',
			},
		},
		async ({ deck: { title, description, cards }, username }) => {
			const key = userKey(username);
			const deck: Deck = {
				// randomUUID never collides, unlike Date.now() for two calls in the same millisecond.
				id: `deck-${crypto.randomUUID()}`,
				title,
				description,
				cards: cards.map((card) => ({ id: `card-${crypto.randomUUID()}`, ...card, status: 'new' })),
				createdAt: new Date().toISOString(),
			};

			await kv.put(`${key}:deck:${deck.id}`, JSON.stringify(deck));

			// Note: read-then-write. Two decks created at the same moment could lose one ID.
			const decksKey = `${key}:decks`;
			const deckIds = (await kv.get<string[]>(decksKey, 'json')) ?? [];
			deckIds.push(deck.id);
			await kv.put(decksKey, JSON.stringify(deckIds));

			return {
				content: [
					{
						type: 'text',
						text: `Created the "${title}" deck (id: ${deck.id}) with ${deck.cards.length} flashcards.`,
					},
				],
				structuredContent: { deck, username },
			};
		},
	);

	// list decks
	registerAppTool(
		server,
		'list-decks',
		{
			title: 'List Decks',
			description:
				"Use this to show the user a list of their decks. Ask the user for their username before using this tool if you don't know it.",
			inputSchema: z.object({
				username: usernameSchema,
			}),
			annotations: {
				readOnlyHint: true,
			},
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Loading your decks...',
				'openai/toolInvocation/invoked': 'Decks loaded.',
			},
		},
		async ({ username }) => {
			const key = userKey(username);
			const deckIds = (await kv.get<string[]>(`${key}:decks`, 'json')) ?? [];

			// Read all decks at the same time instead of one by one.
			const loaded = await Promise.all(deckIds.map((deckId) => kv.get<Deck>(`${key}:deck:${deckId}`, 'json')));
			const decks = loaded
				.filter((deck): deck is Deck => deck !== null)
				.map((deck) => ({ ...deck, masteredCount: countMastered(deck) }));

			if (decks.length === 0) {
				return {
					content: [{ type: 'text', text: `${username} has no decks yet.` }],
					structuredContent: { decks: [], username },
				};
			}

			// A short summary with IDs is enough for the model; the widget gets the full cards.
			const lines = decks.map(
				(deck) => `- ${deck.title} (id: ${deck.id}, ${deck.cards.length} cards, ${deck.masteredCount} mastered)`,
			);
			return {
				content: [{ type: 'text', text: `Found ${decks.length} decks for ${username}:\n${lines.join('\n')}` }],
				structuredContent: { decks, username },
			};
		},
	);

	// open deck
	registerAppTool(
		server,
		'open-deck',
		{
			title: 'Open Deck',
			description:
				"Use this to open a deck for the user to study. Ask the user for their username before using this tool if you don't know it. Requires a deck ID from `list-decks`.",
			inputSchema: z.object({
				username: usernameSchema,
				deckId: deckIdSchema,
			}),
			annotations: {
				readOnlyHint: true,
			},
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Opening deck...',
				'openai/toolInvocation/invoked': 'Deck opened.',
			},
		},
		async ({ username, deckId }) => {
			const deck = await kv.get<Deck>(`${userKey(username)}:deck:${deckId}`, 'json');

			if (!deck) {
				return deckNotFound(deckId);
			}

			return {
				content: [
					{
						type: 'text',
						text: `Opened "${deck.title}" (${deck.description}) for studying: ${deck.cards.length} cards, ${countMastered(deck)} mastered. The cards are shown in the widget.`,
					},
				],
				structuredContent: { deck, username },
			};
		},
	);

	// mark card (private)

	// reset deck (private)

	// delete deck
	registerAppTool(
		server,
		'delete-deck',
		{
			title: 'Delete Deck',
			description:
				"Use this to permanently delete one of the user's decks. Only use it when the user clearly asks to delete a deck. Ask for their username if you don't know it. Requires a deck ID from `list-decks`.",
			inputSchema: z.object({
				username: usernameSchema,
				deckId: deckIdSchema,
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
			},
			_meta: {
				'openai/toolInvocation/invoking': 'Deleting deck...',
				'openai/toolInvocation/invoked': 'Deck deleted.',
			},
		},
		async ({ username, deckId }) => {
			const key = userKey(username);
			const deck = await kv.get<Deck>(`${key}:deck:${deckId}`, 'json');

			if (!deck) {
				return deckNotFound(deckId);
			}

			await kv.delete(`${key}:deck:${deckId}`);

			// Also remove the ID from the user's deck list, or it would point at nothing.
			const decksKey = `${key}:decks`;
			const deckIds = (await kv.get<string[]>(decksKey, 'json')) ?? [];
			await kv.put(decksKey, JSON.stringify(deckIds.filter((id) => id !== deckId)));

			return {
				content: [{ type: 'text', text: `Deleted the "${deck.title}" deck (id: ${deckId}).` }],
				structuredContent: { deletedDeckId: deckId, username },
			};
		},
	);

	return server;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const handler = createMcpHandler(() => createServer(env));
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
