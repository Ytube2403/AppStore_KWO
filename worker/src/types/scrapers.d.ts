// Type declarations for app-store-scraper
declare module 'app-store-scraper' {
    interface AppResult {
        id: number
        appId: string
        title: string
        url: string
        description: string
        icon: string
        genres: string[]
        genreIds: string[]
        primaryGenre: string
        primaryGenreId: number
        contentRating: string
        languages: string[]
        size: string
        requiredOsVersion: string
        released: string
        updated: string
        releaseNotes: string
        version: string
        price: number
        currency: string
        free: boolean
        developerId: string
        developer: string
        developerUrl: string
        developerWebsite: string
        score: number
        reviews: number
        currentVersionScore: number
        currentVersionReviews: number
        screenshots: string[]
        ipadScreenshots: string[]
        appletvScreenshots: string[]
        supportedDevices: string[]
    }

    interface SearchOptions {
        term: string
        num?: number
        page?: number
        country?: string
        lang?: string
        idsOnly?: boolean
    }

    interface ListOptions {
        collection?: string
        category?: number
        country?: string
        lang?: string
        num?: number
        fullDetail?: boolean
    }

    const collection: Record<string, string>
    const category: Record<string, number>

    function search(options: SearchOptions): Promise<AppResult[]>
    function list(options: ListOptions): Promise<AppResult[]>
    function app(options: { id?: number; appId?: string; country?: string; lang?: string; ratings?: boolean }): Promise<AppResult>
    function developer(options: { devId: string; country?: string; lang?: string }): Promise<AppResult[]>
    function suggest(options: { term: string; country?: string }): Promise<{ term: string }[]>
    function similar(options: { id?: number; appId?: string; country?: string; lang?: string }): Promise<AppResult[]>
    function reviews(options: { id?: number; appId?: string; country?: string; page?: number; sort?: number }): Promise<any[]>

    const _default: {
        search: typeof search
        list: typeof list
        app: typeof app
        developer: typeof developer
        suggest: typeof suggest
        similar: typeof similar
        reviews: typeof reviews
        collection: typeof collection
        category: typeof category
    }
    export = _default
}

// Type declarations for google-play-scraper
declare module 'google-play-scraper' {
    interface AppResult {
        appId: string
        url: string
        title: string
        summary: string
        developer: string
        developerId: string
        icon: string
        score: number
        scoreText: string
        priceText: string
        free: boolean
        currency?: string
        price?: number
        description?: string
        descriptionHTML?: string
        installs?: string
        minInstalls?: number
        ratings?: number
        reviews?: number
        histogram?: Record<string, number>
        contentRating?: string
        genre?: string
        genreId?: string
        headerImage?: string
        screenshots?: string[]
        video?: string
        updated?: number
        version?: string
        releaseDate?: string
        released?: string
        androidVersion?: string
        androidVersionText?: string
    }

    interface SearchOptions {
        term: string
        num?: number
        lang?: string
        country?: string
        fullDetail?: boolean
        price?: 'all' | 'free' | 'paid'
    }

    interface ListOptions {
        collection?: string
        category?: string
        age?: string
        num?: number
        lang?: string
        country?: string
        fullDetail?: boolean
    }

    const collection: Record<string, string>
    const category: Record<string, string>

    function search(options: SearchOptions): Promise<AppResult[]>
    function list(options: ListOptions): Promise<AppResult[]>
    function app(options: { appId: string; lang?: string; country?: string }): Promise<AppResult>
    function developer(options: { devId: string; lang?: string; country?: string; num?: number; fullDetail?: boolean }): Promise<AppResult[]>
    function suggest(options: { term: string; lang?: string; country?: string }): Promise<string[]>
    function similar(options: { appId: string; lang?: string; country?: string; fullDetail?: boolean }): Promise<AppResult[]>
    function reviews(options: { appId: string; lang?: string; country?: string; sort?: number; num?: number; paginate?: boolean; nextPaginationToken?: string }): Promise<any>

    const _default: {
        search: typeof search
        list: typeof list
        app: typeof app
        developer: typeof developer
        suggest: typeof suggest
        similar: typeof similar
        reviews: typeof reviews
        collection: typeof collection
        category: typeof category
    }
    export = _default
}
