# Recipe library - plan

State (built, pilot done): ALL third-party recipes are PRIVATE. They live in the user's Supabase table `records` (kind 'library'), written by a GitHub Action, and reach the app through the normal sync (docs/food-library.js: loadLibrary(store.all('library'))). Nothing third-party is committed (docs/data/library/index.json is an empty stub; tests use synthetic tests/fixtures/library-sample.json). Format: top of docs/food-library.js.

## How to run / scale
- List sources in scripts/library/sources.json: `{ "exclude": ["seafood"], "sources": [ { "source": "bbcgoodfood", "urls": [...] } ] }`. Per source: `urls` (recipe pages), `collections` (+ `link_pattern` regex on the path, `limit`) which are expanded to recipe links, `mealdb_ids`, `mealdb_categories` (Chicken, Beef, Pork, Lamb, Vegetarian, Breakfast...). `exclude`: 'seafood' (shellfish etc.) always; add 'fish' to drop regular fish too. `html_fallback: true` = parse "Ingredients/Instructions" text when a page has no schema.org Recipe (used for Ethan Chlebowski).
- Local check (no Supabase, prints counts only, writes scripts/library/.out/library.json which is gitignored): `node scripts/library/import.mjs --dry-run [--verbose] [source ...]`.
- Real run: push, then GitHub > Actions > "Recipe library import" > Run workflow (input `sources` empty = all). Uses the repo secret SUPABASE_SECRET_KEY, finds the single user via the Auth admin API, upserts records with deterministic ids (uuid5 of user:library:source:source_id), so re-runs update instead of duplicating. Logs are public: only counts and generic messages. ~1.5 s per recipe (a 300-recipe run is about 10 minutes).
- Per recipe: published per-serving nutrition (JSON-LD) is preferred (`nutrition_basis: 'published'`, our computed numbers kept in `computed_per_serving`); otherwise computed. Missing servings/time/main are estimated and flagged in `est`. When servings are missing but nutrition is published, servings = computed total kcal / published kcal.
- Recipes are hot-linked images, personal use only, source name + link on each; never publish the table.

## Expected counts (collection URLs to list)
- BBC Good Food: /recipes/collection/high-protein-recipes (~27 links per page, JSON-LD complete: nutrition, times, yield), plus high-protein dinner/breakfast/vegetarian, chicken-breast, healthy-chicken and family collections: ~150-250. link_pattern `^/recipes/[a-z0-9-]+$`.
- Skinnytaste: /recipes/high-protein/ (paged /page/N/), main-ingredient/chicken-recipes, beef, turkey, pork, lamb: ~200-300 (seafood/fish/shrimp categories are skipped by the filter anyway). Recipe links are `^/[a-z0-9-]+/$` on the collection page (nav links also match: the importer drops pages with no Recipe data).
- Pinch of Yum: /recipes/dinner and /recipes/quick-and-easy (paged /page/N), link_pattern `^/[a-z0-9-]+$`: ~100-200.
- Budget Bytes: see below (blocked from scripts here).
- TheMealDB: mealdb_categories Chicken, Beef, Pork, Lamb, Vegetarian, Breakfast, Pasta, Starter, Side, Dessert (Seafood is skipped): ~350. No servings/time/main published: all estimated.
- Ethan Chlebowski: see below.

## Source findings (pilot dry run 2026-09-29)
- BBC Good Food, Skinnytaste, Pinch of Yum: schema.org Recipe with nutrition, times, yield, image: all fields present. Pinch of Yum has some quirks (no video, blog-style titles).
- Budget Bytes: recipe pages (and its wp-json API) answer HTTP 403 with a Cloudflare "Just a moment" challenge to scripted requests from this machine, even with a browser User-Agent; only sitemap XML is open. Not bypassed (bot check). Its URLs stay in sources.json: the first Action run will show whether GitHub's network gets through (log line "budgetbytes #N: fetch/convert error"); if not, drop it.
- Ethan Chlebowski (ethanchlebowski.com/cooking-techniques-recipes/<slug>, Squarespace): fetchable, photos in og:image, ~20 recipes listed on the index page, but NO schema.org Recipe (JSON-LD is only Article/Organization). Ingredients and Instructions are plain text under "Ingredients"/"Instructions" headings, so the html_fallback parser reads them. Quality is lower: amounts are often vague ("a handful", "a spoonful"), sub-headings become unmatched rows, no servings/time/nutrition (all estimated, ~60% of ingredients matched vs ~98% for the schema.org sources), and some pages are technique posts without a recipe. Verdict: usable as a small extra (mostly for photos and taste), not a bulk source. Every recipe page is titled with the dish name, which is handy for search.
- Converter fixes made from the pilot: "one 14-ounce can X", "an 8-ounce block", "N-inch knob", "4 garlic cloves crushed", "3 finely chopped garlic clove", "4 chicken breasts (about 8 oz each)", stock cubes, sprig/pinch/handful/bunch, "to serve/for garnish/spray" lines (see normalizeLine in scripts/library/convert.mjs, tests/library-import.test.js).
- Still imperfect: "1 pot sour cream", "2 chicken stock cubes" (no gram weight), vague "a handful of" without a food match; they stay flagged 'check' and are not counted in macros.

## Facts every recipe has (estimated when the source does not say)
main_ingredient, prep_min + cook_min, servings, per_serving macros. Guessed values are flagged `est: {main, time, servings}` and the UI shows "(est.)" (docs/food-estimate.js: estimateMain / estimateTime / estimateServings; tests/food-estimate.test.js). Tap time / servings / main on a recipe to correct it: this saves "Your version" (own recipe with `from_library`) or updates your own recipe, and clears the est flag. Filters (Library > Filters): sort (protein per 100 kcal, kcal, time, name), source, time <=15/30/45/60, main ingredient (multi), protein >=20/30/40 g, kcal <=400/600/800, cuisine, course, vegetarian, favourites. Own recipes appear in the same list (source "My recipes").

## TheMealDB
- Free test key "1": https://www.themealdb.com/api/json/v1/1/ . Listed in sources.json as `mealdb_ids` / `mealdb_categories`; the importer looks each meal up (1.5 s pause). Seafood category is skipped.
- No servings, times or main ingredient in MealDB: all three are estimated and flagged. Per-recipe fixes: scripts/library/mealdb-overrides.json ({"<id>": {"servings": 6, "lines": {"<original line>": "<replacement>"}}}).
- Licensing: free test key for personal/educational use; recipes and photos are user-contributed; photos hot-linked. Now private like every other source.

## Source research (2026-09-29; script check of JSON-LD schema.org/Recipe on 2-4 pages each)
| Source | Fetchable | Photo | Nutrition | High-protein | Terms | Verdict |
|---|---|---|---|---|---|---|
| TheMealDB | API, stable | yes | no | ~350 meat/fish mains, unmarked | free key, personal use | keep, expand |
| BBC Good Food | yes (plain GET, sitemap.xml, JSON-LD 3/3) | yes | yes: kcal + protein, prep/cook/total, yield | best: "high-protein" collection (27 links on page 1, more paged) + many `/recipes/collection/...` | BBC copyright, personal non-commercial use; not licensed for republishing | best data, private storage only |
| Skinnytaste | yes (sitemap 671 posts, JSON-LD 4/4) | yes | yes (kcal, protein, usually all macros) | very good: chicken/fish/turkey, macros per serving | blogger copyright, personal use | good, private only |
| Budget Bytes | yes with a normal UA (sitemap ~975 posts, JSON-LD 2/2); page embeds a bot UA blocklist (python/curl/scrapy), be gentle | yes | yes | medium: cheap chicken/beef/bean meals | blogger copyright, personal use | filler |
| Pinch of Yum | yes (sitemap ~911, JSON-LD 1/1; some posts are not recipes) | yes | some | medium | copyright | optional |
| Allrecipes, Serious Eats, Simply Recipes | NO: HTTP 402 to scripts | - | - | - | - | skip |
| aniagotuje.pl (PL) | fetch OK, robots allow, sitemap.xml; NO JSON-LD Recipe, microdata only | yes | partial | low | copyright | later, needs microdata parser |
| kwestiasmaku.com (PL) | fetch OK, schema.org/Recipe microdata, no JSON-LD | yes | no | medium | copyright | later, needs microdata parser |
| Spoonacular API | API key | yes | yes | minProtein filter | free tier ~150 calls/day; storing/caching results restricted; attribution | not for a stored library |
| Edamam Recipe API | API key | yes | yes | nutrient filters | free tier rate-limited, caching forbidden beyond short term, link back required | not for a stored library |
| Open datasets (Recipe1M-style, Kaggle) | files | mostly no | partial | - | research/non-commercial licences | skip |

Pilot (pipeline proof; scratch file only, deleted): 2 recipes each from BBC Good Food, Skinnytaste, Budget Bytes and 1 Pinch of Yum went through convertRecipe (JSON-LD -> raw -> library format) with image, servings, times, macros, checks. Our computed macros vs the site's published per serving: stroganoff 530 vs 425 kcal (P 64 vs 43); salmon risotto 532 vs 806 (P 12 vs 40, salmon lines unmatched); Skinnytaste curry 273 vs 213; Budget Bytes chicken 292 vs 436 (P 10 vs 39). Gaps of 20-60% are common (raw vs cooked weights, unmatched lines). CONCLUSION: for imported sources use the source's published per-serving kcal/P/C/F as `per_serving` (that is what filters and sorting use), keep the app's own computation for the ingredient breakdown and "Check these".

## App notes
- Library records are read with store.all('library') (id = record uuid, `key` = source:source_id). Existing favourites or "Your version" copies made on the old static ids (mealdb-52832 ...) no longer match; the 9 pilot recipes have new ids.
- Empty library shows "Recipe library is being prepared". Optional static files data/library/index.json + <source>.json are still merged when present (none today).
- Favourites/ratings: store config 'library' {favs, cooked}. Remove a favourite with the heart on the recipe or on the Favourites list.
- Later ideas: a "cooked it" history list, sorting by rating, dedupe across sources by normalised title + first ingredients.
