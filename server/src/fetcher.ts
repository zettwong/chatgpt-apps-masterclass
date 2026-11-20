export type TMDBMovie = {
	id: number;
	title: string;
	overview: string;
	release_date: string;
	poster_path: string | null;
	backdrop_path: string | null;
	vote_average: number;
	genre_ids: number[];
};

export type TMDBMovieList = {
	page: number;
	results: TMDBMovie[];
	total_pages: number;
	total_results: number;
};

export type TMDBGenre = {
	id: number;
	name: string;
};

export type TMDBGenreList = {
	genres: TMDBGenre[];
};

export type TMDBReview = {
	id: string;
	author: string;
	content: string;
	created_at: string;
	url: string;
	author_details: { rating: number | null };
};

export type TMDBReviewList = {
	id: number;
	page: number;
	results: TMDBReview[];
};

export type TMDBMovieDetails = Omit<TMDBMovie, 'genre_ids'> & {
	runtime: number | null;
	tagline: string;
	genres: TMDBGenre[];
	production_companies: { id: number; name: string }[];
	credits: {
		cast: { id: number; name: string; character: string }[];
	};
};

async function fetchFromTMDB<T>(endpoint: string, apiKey: string, params: Record<string, string> = {}): Promise<T> {
	const searchParams = new URLSearchParams({
		page: '1',
		include_adult: 'false',
		language: 'en',
		...params,
	});
	const response = await fetch(`https://api.themoviedb.org/3${endpoint}?${searchParams}`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		throw new Error(`TMDB ${endpoint} failed: ${response.status} ${response.statusText}`);
	}

	return response.json() as Promise<T>;
}

export async function fetchUpcomingMovies(apiKey: string) {
	return fetchFromTMDB<TMDBMovieList>('/movie/upcoming', apiKey);
}

export async function fetchNowPlayingMovies(apiKey: string) {
	return fetchFromTMDB<TMDBMovieList>('/movie/now_playing', apiKey);
}

export async function fetchSimilarMovies(movieId: number, apiKey: string) {
	return fetchFromTMDB<TMDBMovieList>(`/movie/${movieId}/similar`, apiKey);
}

export async function fetchMovieReviews(movieId: number, apiKey: string) {
	return fetchFromTMDB<TMDBReviewList>(`/movie/${movieId}/reviews`, apiKey);
}

export async function fetchMovieGenres(apiKey: string) {
	return fetchFromTMDB<TMDBGenreList>('/genre/movie/list', apiKey);
}

export async function fetchMovieByGenre(genreId: number, apiKey: string) {
	return fetchFromTMDB<TMDBMovieList>('/discover/movie', apiKey, {
		with_genres: String(genreId),
		sort_by: 'popularity.desc',
	});
}

export async function fetchMovieDetails(movieId: number, apiKey: string) {
	// `credits` adds the cast, which the get-movie-details tool promises.
	return fetchFromTMDB<TMDBMovieDetails>(`/movie/${movieId}`, apiKey, {
		append_to_response: 'credits',
	});
}
