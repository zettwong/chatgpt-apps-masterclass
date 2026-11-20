import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp';
import { z } from 'zod';
import {
	fetchMovieByGenre,
	fetchMovieDetails,
	fetchMovieGenres,
	fetchMovieReviews,
	fetchNowPlayingMovies,
	fetchSimilarMovies,
	fetchUpcomingMovies,
	type TMDBMovieList,
} from './fetcher';

const WIDGET_URI = 'ui://movies-widget';

// The widget's built JS/CSS are loaded from here (see `base` in widgets/vite.config.ts).
const WIDGET_DOMAIN = 'https://server.tlswjd890.workers.dev';

// Short text for the model: titles with IDs, so it can call the ID-based tools next.
function summarizeMovies(label: string, list: TMDBMovieList) {
	const lines = list.results.map((movie) => `- ${movie.title} (id: ${movie.id}, release: ${movie.release_date || 'unknown'})`);
	return `Found ${list.results.length} ${label}:\n${lines.join('\n')}`;
}

function createServer(env: Env) {
	const server = new McpServer({
		name: 'Movies Server',
		version: '1.0',
	});

	registerAppResource(server, 'Movies Widget', WIDGET_URI, { description: 'Movies Widget' }, async () => {
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
								// scripts, styles, images, fonts. image.tmdb.org serves the movie posters.
								resourceDomains: [WIDGET_DOMAIN, 'https://image.tmdb.org'],
								connectDomains: [WIDGET_DOMAIN], // fetch / WebSocket
							},
						},
					},
				},
			],
		};
	});

	registerAppTool(
		server,
		'get-upcoming-movies',
		{
			title: 'Get Upcoming Movies',
			description:
				'Use this when the user wants to see the movies that are going to be released soon or in the future. Do not use this for movies that are currently playing in theaters or available for streaming.',
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true },
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Fetching upcoming movies...',
				'openai/toolInvocation/invoked': 'Done.',
			},
		},
		async () => {
			const movies = await fetchUpcomingMovies(env.API_KEY);
			return {
				content: [{ type: 'text', text: summarizeMovies('upcoming movies', movies) }],
				structuredContent: { movies },
			};
		},
	);

	registerAppTool(
		server,
		'get-now-playing-movies',
		{
			title: 'Get Now Playing Movies',
			description:
				'Use this when the user wants to see the movies that are playing right now. Do not use this for streaming movies or to check the availability of upcoming releases. Do not use this to find a specific movie.',
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true },
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Fetching now playing movies...',
				'openai/toolInvocation/invoked': 'Done.',
			},
		},
		async () => {
			const movies = await fetchNowPlayingMovies(env.API_KEY);
			return {
				content: [{ type: 'text', text: summarizeMovies('movies playing now', movies) }],
				structuredContent: { movies },
			};
		},
	);

	registerAppTool(
		server,
		'get-similar-movies',
		{
			title: 'Get Similar Movies',
			description:
				'Use this when the user wants to find similar movies to a specific movie. Requires a movie ID from a previous list. Do not use before identifying a specific movie.',
			inputSchema: z.object({
				movieId: z
					.number()
					.int()
					.positive()
					.describe(
						'The ID of the movie to find similar movies for. Obtained by calling other tools first like `get-upcoming-movies` or `get-now-playing-movies`.',
					),
			}),
			annotations: { readOnlyHint: true },
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Fetching similar movies...',
				'openai/toolInvocation/invoked': 'Done.',
			},
		},
		async ({ movieId }) => {
			const movies = await fetchSimilarMovies(movieId, env.API_KEY);
			return {
				content: [{ type: 'text', text: summarizeMovies(`movies similar to ${movieId}`, movies) }],
				structuredContent: { movies },
			};
		},
	);

	registerAppTool(
		server,
		'get-movie-reviews',
		{
			title: 'Get Movie Reviews',
			description:
				'Use this when the user wants to find reviews about a specific movie. Requires a movie ID from a previous list. Do not use before identifying a specific movie.',
			inputSchema: z.object({
				movieId: z
					.number()
					.int()
					.positive()
					.describe(
						'The ID of the movie to find reviews for. Obtained by calling other tools first like `get-upcoming-movies` or `get-now-playing-movies`.',
					),
			}),
			annotations: { readOnlyHint: true },
			_meta: {
				'openai/toolInvocation/invoking': 'Fetching reviews...',
				'openai/toolInvocation/invoked': 'Done.',
			},
		},
		async ({ movieId }) => {
			const reviews = await fetchMovieReviews(movieId, env.API_KEY);
			// No widget for this tool, so the model reads the reviews from the text.
			const text =
				reviews.results.length === 0
					? `No reviews found for movie ${movieId}.`
					: reviews.results
							.map((review) => `Review by ${review.author} (rating: ${review.author_details.rating ?? 'n/a'}):\n${review.content}`)
							.join('\n\n');
			return {
				content: [{ type: 'text', text }],
				structuredContent: { reviews },
			};
		},
	);

	registerAppTool(
		server,
		'get-movie-genres',
		{
			title: 'Get Movie Genres',
			description:
				'Use this to get the list of genre IDs. This should be used before calling the `get-movies-by-genre` tool. Do not use this to search for movies directly.',
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true },
			_meta: {
				'openai/toolInvocation/invoking': 'Fetching genres...',
				'openai/toolInvocation/invoked': 'Done.',
			},
		},
		async () => {
			const genres = await fetchMovieGenres(env.API_KEY);
			return {
				content: [{ type: 'text', text: genres.genres.map((genre) => `${genre.name}: ${genre.id}`).join('\n') }],
				structuredContent: { genres },
			};
		},
	);

	registerAppTool(
		server,
		'get-movies-by-genre',
		{
			title: 'Get Movies by Genre',
			description:
				'Use this when the user wants to find movies by a specific genre. Call `get-movie-genres` first to get the list of genre IDs.',
			inputSchema: z.object({
				genreId: z
					.number()
					.int()
					.positive()
					.describe(
						'The ID of the genre to find movies for. Obtained by calling the `get-movie-genres` tool (example: 28 for Action, 99 for Documentary).',
					),
			}),
			annotations: { readOnlyHint: true },
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Fetching movies...',
				'openai/toolInvocation/invoked': 'Done.',
			},
		},
		async ({ genreId }) => {
			const movies = await fetchMovieByGenre(genreId, env.API_KEY);
			return {
				content: [{ type: 'text', text: summarizeMovies(`movies in genre ${genreId}`, movies) }],
				structuredContent: { movies },
			};
		},
	);

	registerAppTool(
		server,
		'get-movie-details',
		{
			title: 'Get Movie Details',
			description:
				'Use this when the user wants to see more details about a specific movie. Details like synopsis, cast, and production companies are available here. Requires a movie ID from a previous list. Do not use this tool before identifying the movie.',
			inputSchema: z.object({
				movieId: z
					.number()
					.int()
					.positive()
					.describe('The ID of the movie to find details for. Obtained by calling any of the movie list tools.'),
			}),
			annotations: { readOnlyHint: true },
			_meta: {
				ui: {
					resourceUri: WIDGET_URI,
				},
				'openai/toolInvocation/invoking': 'Fetching movie details...',
				'openai/toolInvocation/invoked': 'Done.',
			},
		},
		async ({ movieId }) => {
			const movie = await fetchMovieDetails(movieId, env.API_KEY);
			const cast = movie.credits.cast
				.slice(0, 5)
				.map((person) => person.name)
				.join(', ');
			const companies = movie.production_companies.map((company) => company.name).join(', ');
			return {
				content: [
					{
						type: 'text',
						text: `${movie.title} (id: ${movie.id}, release: ${movie.release_date || 'unknown'})\nSynopsis: ${movie.overview}\nCast: ${cast}\nProduction companies: ${companies}`,
					},
				],
				structuredContent: { movie },
			};
		},
	);

	return server;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {

		const API_KEY = env.API_KEY;

		const handler = createMcpHandler(() => createServer(env));
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
