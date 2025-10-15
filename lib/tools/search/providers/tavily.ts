import { SearchResultImage, SearchResults, SearchResultItem } from '@/lib/types'
import { sanitizeUrl } from '@/lib/utils'
import { BaseSearchProvider } from './base'

interface TavilySearchOptions {
  query: string
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
  includeDomains?: string[]
  excludeDomains?: string[]
  includeRawContent?: boolean
  topic?: 'general' | 'news'
  days?: number
}

interface CacheEntry {
  data: SearchResults
  timestamp: number
}

// Extended types to match Tavily's response
interface ExtendedSearchResultItem extends SearchResultItem {
  score?: number
}

interface ExtendedSearchResults extends SearchResults {
  answer?: string
}

export class TavilySearchProvider extends BaseSearchProvider {
  private cache: Map<string, CacheEntry> = new Map()
  private pendingRequests: Map<string, Promise<SearchResults>> = new Map()
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  private readonly MAX_CACHE_SIZE = 100
  private readonly REQUEST_TIMEOUT = 15000 // 15 seconds

  /**
   * Enhanced search with caching, deduplication, and parallel processing
   */
  async search(
    query: string,
    maxResults: number = 10,
    searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = []
  ): Promise<SearchResults> {
    const cacheKey = this.getCacheKey(
      query,
      maxResults,
      searchDepth,
      includeDomains,
      excludeDomains
    )

    // Check cache first
    const cached = this.getFromCache(cacheKey)
    if (cached) {
      return cached
    }

    // Check if there's already a pending request for the same query
    const pending = this.pendingRequests.get(cacheKey)
    if (pending) {
      return pending
    }

    // Create new request
    const request = this.executeSearch({
      query,
      maxResults,
      searchDepth,
      includeDomains,
      excludeDomains
    })

    this.pendingRequests.set(cacheKey, request)

    try {
      const results = await request
      this.setCache(cacheKey, results)
      return results
    } finally {
      this.pendingRequests.delete(cacheKey)
    }
  }

  /**
   * Deep search with parallel multi-depth queries for comprehensive results
   */
  async deepSearch(
    query: string,
    options: {
      maxResults?: number
      includeDomains?: string[]
      excludeDomains?: string[]
      includeRawContent?: boolean
    } = {}
  ): Promise<SearchResults> {
    const { maxResults = 10, includeDomains = [], excludeDomains = [], includeRawContent = false } = options

    // Execute parallel searches with different depths and merge results
    const [basicResults, advancedResults] = await Promise.all([
      this.executeSearch({
        query,
        maxResults: Math.ceil(maxResults / 2),
        searchDepth: 'basic',
        includeDomains,
        excludeDomains,
        includeRawContent
      }),
      this.executeSearch({
        query,
        maxResults: Math.ceil(maxResults / 2),
        searchDepth: 'advanced',
        includeDomains,
        excludeDomains,
        includeRawContent
      })
    ])

    return this.mergeResults([basicResults, advancedResults], maxResults)
  }

  /**
   * Batch search for multiple queries in parallel
   */
  async batchSearch(
    queries: string[],
    options: {
      maxResultsPerQuery?: number
      searchDepth?: 'basic' | 'advanced'
      includeDomains?: string[]
      excludeDomains?: string[]
    } = {}
  ): Promise<Map<string, SearchResults>> {
    const {
      maxResultsPerQuery = 10,
      searchDepth = 'basic',
      includeDomains = [],
      excludeDomains = []
    } = options

    const searches = queries.map(async query => ({
      query,
      results: await this.search(
        query,
        maxResultsPerQuery,
        searchDepth,
        includeDomains,
        excludeDomains
      )
    }))

    const results = await Promise.all(searches)
    return new Map(results.map(({ query, results }) => [query, results]))
  }

  /**
   * Contextual search that expands the query with related terms
   */
  async contextualSearch(
    query: string,
    options: {
      maxResults?: number
      searchDepth?: 'basic' | 'advanced'
      expandQuery?: boolean
    } = {}
  ): Promise<SearchResults> {
    const { maxResults = 10, searchDepth = 'advanced', expandQuery = true } = options

    if (!expandQuery) {
      return this.search(query, maxResults, searchDepth)
    }

    // Generate query variations for broader coverage
    const queryVariations = this.generateQueryVariations(query)
    
    // Execute searches in parallel
    const searches = queryVariations.slice(0, 3).map(q =>
      this.executeSearch({
        query: q,
        maxResults: Math.ceil(maxResults / 2),
        searchDepth
      })
    )

    const results = await Promise.all(searches)
    return this.mergeResults(results, maxResults)
  }

  /**
   * Execute the actual Tavily API search
   */
  private async executeSearch(options: TavilySearchOptions): Promise<SearchResults> {
    const {
      query,
      maxResults = 10,
      searchDepth = 'basic',
      includeDomains = [],
      excludeDomains = [],
      includeRawContent = false,
      topic = 'general',
      days
    } = options

    const apiKey = process.env.TAVILY_API_KEY
    this.validateApiKey(apiKey, 'TAVILY')

    // Tavily API requires a minimum of 5 characters in the query
    const filledQuery = query.length < 5 ? query + ' '.repeat(5 - query.length) : query

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT)

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: filledQuery,
          max_results: Math.max(maxResults, 5),
          search_depth: searchDepth,
          include_images: true,
          include_image_descriptions: true,
          include_answers: true,
          include_raw_content: includeRawContent,
          include_domains: includeDomains.length > 0 ? includeDomains : undefined,
          exclude_domains: excludeDomains.length > 0 ? excludeDomains : undefined,
          topic,
          days
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error(`Tavily API error: ${response.status} ${response.statusText}`, errorText)
        throw new Error(`Search failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      return this.processResults(data)
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Search request timed out')
      }
      throw error
    }
  }

  /**
   * Process and normalize Tavily API results
   */
  private processResults(data: any): SearchResults {
    const processedImages: SearchResultImage[] = (data.images || [])
      .map(
        (item: string | { url: string; description: string }) => {
          if (typeof item === 'string') {
            return { url: sanitizeUrl(item), description: '' }
          }
          return {
            url: sanitizeUrl(item.url),
            description: item.description || ''
          }
        }
      )
      .filter((image: SearchResultImage) => image.url)

    return {
      ...data,
      images: processedImages,
      results: (data.results || []).map((result: any) => ({
        ...result,
        url: sanitizeUrl(result.url)
      }))
    }
  }

  /**
   * Merge multiple search results, removing duplicates and ranking by relevance
   */
  private mergeResults(results: SearchResults[], maxResults?: number): SearchResults {
    const limit = maxResults || 20

    if (results.length === 0) {
      return { results: [], images: [] }
    }

    if (results.length === 1) {
      return results[0]
    }

    // Merge and deduplicate results
    const urlSet = new Set<string>()
    const mergedResults = []

    for (const result of results) {
      for (const item of result.results || []) {
        if (!urlSet.has(item.url)) {
          urlSet.add(item.url)
          mergedResults.push(item)
        }
      }
    }

    // Sort by score if available
    mergedResults.sort((a, b) => (b.score || 0) - (a.score || 0))
    
    // Limit results
    const limitedResults = mergedResults.slice(0, limit)

    // Merge images
    const imageUrlSet = new Set<string>()
    const mergedImages: SearchResultImage[] = []

    for (const result of results) {
      for (const image of result.images || []) {
        const imgUrl = typeof image === 'string' ? image : image.url
        if (!imageUrlSet.has(imgUrl)) {
          imageUrlSet.add(imgUrl)
          mergedImages.push(typeof image === 'string' ? { url: image, description: '' } : image)
        }
      }
    }

    return {
      query: results[0].query,
      results: limitedResults,
      images: mergedImages.slice(0, 10),
      answer: results[0].answer || results[1]?.answer
    }
  }

  /**
   * Generate query variations for broader coverage
   */
  private generateQueryVariations(query: string): string[] {
    const variations = [query]
    
    // Add quotes for exact phrase matching
    if (!query.includes('"')) {
      variations.push(`"${query}"`)
    }
    
    // Add common question prefixes
    if (!query.toLowerCase().match(/^(what|how|why|when|where|who)/)) {
      variations.push(`what is ${query}`)
      variations.push(`how to ${query}`)
    }
    
    return variations
  }

  /**
   * Generate cache key from search parameters
   */
  private getCacheKey(
    query: string,
    maxResults: number,
    searchDepth: string,
    includeDomains: string[],
    excludeDomains: string[]
  ): string {
    return JSON.stringify({
      query: query.toLowerCase().trim(),
      maxResults,
      searchDepth,
      includeDomains: includeDomains.sort(),
      excludeDomains: excludeDomains.sort()
    })
  }

  /**
   * Get results from cache if valid
   */
  private getFromCache(key: string): SearchResults | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    const age = Date.now() - entry.timestamp
    if (age > this.CACHE_TTL) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  /**
   * Store results in cache with LRU eviction
   */
  private setCache(key: string, data: SearchResults): void {
    // Implement simple LRU: if cache is full, remove oldest entry
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear()
    this.pendingRequests.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttl: this.CACHE_TTL,
      pendingRequests: this.pendingRequests.size
    }
  }
}