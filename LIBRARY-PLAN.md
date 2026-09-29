# Recipe library - plan

State: 9 TheMealDB recipes in docs/data/library/mealdb.json (classic cookbooks were removed, MyPlate is blocked). Format: top of docs/food-library.js.
Rebuild: `node scripts/library/build.mjs [mealdb|myplate]` (converts, validates, rewrites docs/data/library/*.json + index.json). Then add NEW file names to docs/sw.js CORE, `node --test`, `node scripts/release.cjs`.

## Facts every recipe has (estimated when the source does not say)
main_ingredient, prep_min + cook_min, servings, per_serving macros. Guessed values are flagged `est: {main, time, servings}` and the UI shows "(est.)" (docs/food-estimate.js: estimateMain / estimateTime / estimateServings; tests/food-estimate.test.js). Tap time / servings / main on a recipe to correct it: this saves "Your version" (own recipe with `from_library`) or updates your own recipe, and clears the est flag. Filters (Library > Filters): sort (protein per 100 kcal, kcal, time, name), source, time <=15/30/45/60, main ingredient (multi), protein >=20/30/40 g, kcal <=400/600/800, cuisine, course, vegetarian, favourites. Own recipes appear in the same list (source "My recipes").

## TheMealDB (base, in the app)
- Free test key "1": https://www.themealdb.com/api/json/v1/1/ . The 2026 catalogue is much bigger than the pilot: by category chicken 81, beef 95, seafood 84, pork 61, lamb 33, vegetarian 100, breakfast 19 (~350 high-protein mains). By area (filter.php?a=): British 60, Spanish 48, Turkish 30, Thai 27, Chinese 27, Japanese 9, Greek 8, Mexican 6, Moroccan 6 (American/Indian returned 0: check exact names with `list.php?a=list`, e.g. "France" not "French").
- Import path: scripts/library/mealdb-ids.json ({cuisine: [ids]}) + `node scripts/library/build.mjs mealdb` (0.3 s per lookup). To pull whole categories use `filter.php?c=Chicken|Beef|Seafood|Pork|Lamb` and add new area names to AREA_CUISINE in convert.mjs.
- MealDB has no servings, times or main ingredient: all three are estimated and flagged. Per-recipe fixes: scripts/library/mealdb-overrides.json ({"<id>": {"servings": 6, "lines": {"<original line>": "<replacement>"}}}).
- Licensing: free test key for personal/educational use; recipes and photos are user-contributed; photos hot-linked. Public/commercial use needs the paid key. The small set is in the public repo today; for a large import use the private route below.

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

## Import design (next step, not built)
- Private storage (repo is public; third-party text must not be committed): a GitHub Action (manual + weekly) runs `scripts/library/import.mjs`, upserting into the user's Supabase `records` table as kind 'library', one row per recipe (deterministic UUID from the source URL, like the Strava sync; data = library-format JSON incl. `source_nutrition`). Uses the existing SUPABASE_SECRET_KEY secret. Images stay hot-linked. The app loads its kind 'library' rows after login (RLS, own rows only) and merges them with the static TheMealDB file; add source keys ('bbcgoodfood', 'skinnytaste', 'budgetbytes') to SOURCE_TYPES / SOURCE_LABEL in food-library.js.
- Fetch: sitemap.xml or collection page -> recipe URLs -> one GET each -> parse JSON-LD Recipe (recipeIngredient, recipeInstructions HowToStep/HowToSection, recipeYield, ISO 8601 times, nutrition, image). Rate limit 1 request per 2 s, honest UA naming the app, honour robots.txt, cache by URL + lastmod so re-runs fetch only new/changed pages, max ~150 pages per run.
- Dedupe: by source URL (upsert) and by normalised title + first 3 ingredient names across sources (keep the one with published nutrition). Skip pages without Recipe JSON-LD and recipes with >= 4 'check' ingredients and no published nutrition.
- Collections / expected counts: BBC Good Food `/recipes/collection/high-protein-recipes` plus high-protein dinner/breakfast/vegetarian and chicken-breast collections (~150-250); Skinnytaste high-protein, chicken, seafood, turkey categories (~150-250); Budget Bytes chicken/beef/bean + meal prep (~100-150); TheMealDB by category (~350, static file). Realistic total 600-900 recipes, ~5 KB each = 3-5 MB.
- Legal: personal use only, private database, images hot-linked, source name + link on every recipe, never publish the table.

## Recommended for next week
1. BBC Good Food high-protein collections (nutrition + times + yield present).
2. Skinnytaste high-protein / chicken / seafood.
3. TheMealDB by category (chicken, beef, seafood, pork, lamb) via the existing build.
4. Budget Bytes as filler; Polish sites later (microdata parser).

## MyPlate
- NOT FETCHABLE: www.myplate.gov returns HTTP 403 to scripted requests. Left out; build.mjs still reads scripts/library/myplate.json if someone creates it.

## App notes
- Library data is lazy loaded (index.json, then one file per source) and cached by the service worker; add each new data file to sw.js CORE.
- Favourites/ratings: store config 'library' {favs, cooked}. Remove a favourite with the heart on the recipe or on the Favourites list.
- Later ideas: a "cooked it" history list, sorting by rating.
