// Builds docs/data/foods.json — the bundled generic food table used for recipe macros.
//
//   node scripts/food-build-db.cjs
//
// Source: USDA FoodData Central, SR Legacy (April 2018), public domain.
// The CSV zip is downloaded with curl into scripts/.food-usda/ the first time (≈6 MB; that folder
// should be git-ignored). All NUMBERS (kcal, protein, carbs, fat, fibre per 100 g and the portion
// weights) come from the dataset. The English/Polish names and aliases below are written by hand.
//
// Each line of LIST:  key | regex for the USDA description | English name | Polish name | aliases
// The regex is matched case-insensitively; among the matches the SHORTEST description wins
// (that is usually the plain, generic entry). Aliases are comma separated (Polish + English,
// singular/plural forms, common shop names).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CACHE = path.join(__dirname, '.food-usda');
const ZIP_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';
const OUT = path.join(__dirname, '..', 'docs', 'data', 'foods.json');

const LIST = `
# ---------- poultry ----------
chicken-breast|^Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw$|Chicken breast|Pierś z kurczaka|pierś kurczaka, piersi z kurczaka, filet z kurczaka, filety z kurczaka, filet z piersi kurczaka, kurczak, pierś drobiowa, filet drobiowy, chicken breast, chicken fillet, chicken
chicken-thigh|^Chicken, broilers or fryers, dark meat, thigh, meat only, raw$|Chicken thigh (skinless)|Udko z kurczaka bez skóry|udko kurczaka, udka z kurczaka, udek z kurczaka, udek, udka, udko, udziec z kurczaka, filet z uda, filety z ud kurczaka, mięso z ud, chicken thigh, chicken thighs, boneless chicken thigh
chicken-thigh-skin|^Chicken, broilers or fryers, thigh, meat and skin, raw$|Chicken thigh with skin|Udko z kurczaka ze skórą|pałki i udka, ćwiartka z kurczaka, chicken thigh with skin
chicken-drumstick|^Chicken, broilers or fryers, drumstick, meat and skin, raw$|Chicken drumstick|Podudzie z kurczaka|podudzie, podudzia, pałka z kurczaka, pałki z kurczaka, pałki, drumstick, drumsticks
chicken-wing|^Chicken, broilers or fryers, wing, meat and skin, raw$|Chicken wings|Skrzydełka z kurczaka|skrzydełko, skrzydełka, skrzydła, chicken wing, chicken wings, wings
chicken-whole|^Chicken, broilers or fryers, meat and skin, raw$|Whole chicken|Kurczak cały|cały kurczak, kurczak w całości, whole chicken
chicken-ground|^Chicken, ground, raw$|Ground chicken|Mięso mielone z kurczaka|mielone z kurczaka, mielony kurczak, mięso mielone drobiowe, ground chicken, minced chicken
chicken-liver|^Chicken, liver, all classes, raw$|Chicken liver|Wątróbka drobiowa|wątróbka, wątróbki, wątróbki drobiowe, wątróbka z kurczaka, chicken liver, chicken livers
chicken-cooked|^Chicken, broilers or fryers, breast, meat only, cooked, roasted$|Chicken breast, cooked|Pierś z kurczaka pieczona|kurczak pieczony, pieczony kurczak, gotowany kurczak, cooked chicken, roast chicken breast, rotisserie chicken
turkey-breast|^Turkey, whole, breast, meat only, raw$|Turkey breast|Pierś z indyka|filet z indyka, indyk, piersi z indyka, turkey breast, turkey
turkey-ground|^Turkey, Ground, raw$|Ground turkey|Mięso mielone z indyka|mielone z indyka, mielony indyk, ground turkey, minced turkey
turkey-thigh|^Turkey, thigh, from whole bird, meat only, with added solution, raw$|Turkey thigh|Udziec z indyka|udo z indyka, udźce z indyka, turkey thigh
duck|^Duck, domesticated, meat only, raw$|Duck|Kaczka|pierś z kaczki, kaczka, duck, duck breast
# ---------- beef / veal / lamb ----------
beef-ground|^Beef, ground, 80% lean meat / 20% fat, raw$|Ground beef (80/20)|Mięso mielone wołowe|wołowina mielona, mielona wołowina, mielone wołowe, ground beef, minced beef, beef mince, mince
beef-ground-lean|^Beef, ground, 95% lean meat / 5% fat, raw$|Lean ground beef (95/5)|Chuda wołowina mielona|chude mielone wołowe, lean ground beef, extra lean mince
beef-ground-90|^Beef, ground, 90% lean meat / 10% fat, raw$|Ground beef (90/10)|Wołowina mielona 10%|ground beef 90
beef-steak|^Beef, top sirloin, steak, separable lean and fat, trimmed to 1/8"" fat, all grades, raw$|Beef steak (sirloin)|Stek wołowy (rostbef)|stek, steki, rostbef, antrykot, stek wołowy, befsztyk, sirloin, steak, beef steak, ribeye
beef-tenderloin|^Beef, tenderloin, steak, separable lean and fat, trimmed to 1/8"" fat, all grades, raw$|Beef tenderloin|Polędwica wołowa|polędwica wołowa, tenderloin, filet mignon
beef-stew|^Beef, chuck, arm pot roast, separable lean and fat, trimmed to 1/8"" fat, choice, raw$|Beef for stew (chuck)|Wołowina gulaszowa|wołowina, gulasz wołowy, łopatka wołowa, mięso wołowe, szponder, wołowina na gulasz, beef, stewing beef, chuck, beef chuck
beef-round|^Beef, round, full cut, separable lean and fat, trimmed to 1/8"" fat, choice, raw$|Beef round (lean)|Wołowina z udźca|udziec wołowy, zrazowa, zrazy wołowe, beef round
beef-liver|^Beef, variety meats and by-products, liver, raw$|Beef liver|Wątroba wołowa|wątróbka wołowa, beef liver
veal-ground|^Veal, ground, raw$|Ground veal|Cielęcina mielona|cielęcina, mielona cielęcina, veal
lamb|^Lamb, ground, raw$|Lamb (ground)|Jagnięcina mielona|jagnięcina, baranina, mielona jagnięcina, lamb, ground lamb, lamb mince
# ---------- pork ----------
pork-loin|^Pork, fresh, loin, whole, separable lean and fat, raw$|Pork loin|Schab|schab wieprzowy, kotlet schabowy, schabowe, kotlety schabowe, pork loin, pork chop, pork chops
pork-tenderloin|^Pork, fresh, loin, tenderloin, separable lean only, raw$|Pork tenderloin|Polędwiczka wieprzowa|polędwiczki wieprzowe, polędwiczka, pork tenderloin, pork fillet
pork-shoulder|^Pork, fresh, shoulder, whole, separable lean and fat, raw$|Pork shoulder|Łopatka wieprzowa|łopatka, karkówka, karczek, wieprzowina, mięso wieprzowe, pork shoulder, pork butt, pork, pulled pork
pork-ground|^Pork, fresh, ground, raw$|Ground pork|Mięso mielone wieprzowe|mielone wieprzowe, wieprzowina mielona, mięso mielone, mielone, mięso mielone wieprzowo-wołowe, ground pork, minced pork
pork-ribs|^Pork, fresh, spareribs, separable lean and fat, raw$|Pork ribs|Żeberka wieprzowe|żeberka, żeberko, pork ribs, spare ribs, ribs
pork-belly|^Pork, fresh, belly, raw$|Pork belly|Boczek surowy|boczek, surowy boczek, pork belly
bacon|^Pork, cured, bacon, unprepared$|Bacon|Boczek wędzony|bekon, boczek wędzony, plastry boczku, bacon, streaky bacon
ham|^Pork, cured, ham, whole, separable lean only, unheated$|Ham|Szynka|szynka wieprzowa, szynka gotowana, wędlina, ham, sliced ham
sausage-polish|^Polish sausage, pork$|Polish sausage (kiełbasa)|Kiełbasa|kiełbasa, kiełbasa śląska, kiełbasa podwawelska, kiełbasa zwyczajna, kiełbasa wiejska, kiełbaska, kiełbaski, polish sausage, kielbasa, smoked sausage
frankfurter|^Frankfurter, meat$|Hot dog sausage|Parówki|parówka, parówki, frankfurterki, hot dog, frankfurter, frankfurters, wiener
sausage-pork|^Sausage, pork and beef, fresh, cooked$|Pork sausage|Surowa kiełbasa|biała kiełbasa, surowa kiełbasa, pork sausage, sausage, sausages
salami|^Salami, dry or hard, pork, beef$|Salami|Salami|salami, pepperoni, chorizo, kabanosy, kabanos
chicken-sausage-deli|^Chicken breast, deli, rotisserie seasoned, sliced, prepackaged$|Chicken deli slices|Wędlina drobiowa|polędwica z kurczaka, wędlina z indyka, polędwica sopocka, chicken ham, turkey ham, deli meat
lard|^Lard$|Lard|Smalec|smalec, słonina, lard
# ---------- fish & seafood ----------
salmon|^Fish, salmon, Atlantic, farmed, raw$|Salmon|Łosoś|łosoś, filet z łososia, łososia, łososie, salmon, salmon fillet
salmon-smoked|^Fish, salmon, chinook, smoked$|Smoked salmon|Łosoś wędzony|wędzony łosoś, smoked salmon, lox
cod|^Fish, cod, Atlantic, raw$|Cod|Dorsz|dorsz, filet z dorsza, polędwica z dorsza, cod, cod fillet, white fish
pollock|^Fish, pollock, Alaska, raw$|Pollock|Mintaj|mintaj, filet z mintaja, pollock, white fish fillet
hake|^Fish, whiting, mixed species, raw$|Hake / whiting|Morszczuk|morszczuk, hake, whiting
tilapia|^Fish, tilapia, raw$|Tilapia|Tilapia|tilapia
trout|^Fish, trout, rainbow, farmed, raw$|Trout|Pstrąg|pstrąg, trout
mackerel|^Fish, mackerel, Atlantic, raw$|Mackerel|Makrela|makrela, makrela wędzona, mackerel
herring|^Fish, herring, Atlantic, raw$|Herring|Śledź|śledź, śledzie, herring
herring-pickled|^Fish, herring, Atlantic, pickled$|Pickled herring|Śledź marynowany|śledzie w occie, śledź w oleju, matjas, matiasy, pickled herring
carp|^Fish, carp, raw$|Carp|Karp|karp, carp
tuna-fresh|^Fish, tuna, fresh, yellowfin, raw$|Tuna (fresh)|Tuńczyk świeży|stek z tuńczyka, fresh tuna, tuna steak
tuna-water|^Fish, tuna, light, canned in water, drained solids|Tuna in water (canned)|Tuńczyk w sosie własnym|tuńczyk, tuńczyk z puszki, tuńczyk w wodzie, tuńczyk w sosie własnym, canned tuna, tuna, tuna in water
tuna-oil|^Fish, tuna, light, canned in oil, drained solids$|Tuna in oil (canned)|Tuńczyk w oleju|tuńczyk w oleju, tuna in oil
sardines|^Fish, sardine, Atlantic, canned in oil, drained solids with bone$|Sardines in oil|Sardynki w oleju|sardynki, sardynka, sardines
shrimp|^Crustaceans, shrimp, raw$|Shrimp / prawns|Krewetki|krewetki, krewetka, krewetki królewskie, shrimp, prawns, prawn
squid|^Mollusks, squid, mixed species, raw$|Squid|Kalmary|kalmar, kalmary, squid, calamari
mussels|^Mollusks, mussel, blue, raw$|Mussels|Małże|małże, mule, mussels
crab-sticks|^Crustaceans, shrimp, mixed species, imitation, made from surimi$|Surimi / crab sticks|Paluszki krabowe|paluszki surimi, surimi, crab sticks
# ---------- eggs & dairy ----------
egg|^Egg, whole, raw, fresh$|Egg|Jajko|jajko, jajka, jaj, jajek, jaja, jajo, egg, eggs, whole egg
egg-white|^Egg, white, raw, fresh$|Egg white|Białko jaja|białko, białka, białek, białka jaj, egg white, egg whites
egg-yolk|^Egg, yolk, raw, fresh$|Egg yolk|Żółtko|żółtko, żółtka, żółtek, egg yolk, egg yolks, yolk, yolks
milk|^Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D$|Milk 2%|Mleko 2%|mleko, mleka, mleko 2%, mleko 2, milk, 2% milk
milk-whole|^Milk, whole, 3.25% milkfat, with added vitamin D$|Whole milk 3.2%|Mleko 3,2%|mleko 3,2%, mleko pełnotłuste, whole milk, full fat milk
milk-skim|^Milk, nonfat, fluid, with added vitamin A and vitamin D \\(fat free or skim\\)$|Skim milk|Mleko odtłuszczone|mleko 0,5%, mleko chude, skim milk, skimmed milk
buttermilk|^Milk, buttermilk, fluid, cultured, reduced fat$|Buttermilk|Maślanka|maślanka, maślanki, buttermilk
kefir|^Kefir, lowfat, plain, LIFEWAY$|Kefir|Kefir|kefir, kefiru
yogurt|^Yogurt, plain, whole milk$|Natural yogurt|Jogurt naturalny|jogurt, jogurt naturalny, jogurtu, plain yogurt, natural yogurt, yoghurt, yogurt
yogurt-greek|^Yogurt, Greek, plain, whole milk$|Greek yogurt|Jogurt grecki|jogurt grecki, jogurt typu greckiego, greek yogurt, greek yoghurt
yogurt-greek-0|^Yogurt, Greek, plain, nonfat|Greek yogurt 0%|Jogurt grecki 0%|skyr, jogurt 0%, jogurt naturalny 0%, jogurt wysokobiałkowy, nonfat greek yogurt, fat free yogurt
yogurt-lowfat|^Yogurt, plain, low fat$|Low-fat yogurt|Jogurt naturalny light|jogurt light, jogurt 2%, low fat yogurt
cottage|^Cheese, cottage, creamed, large or small curd$|Cottage cheese|Serek wiejski|serek wiejski, serki wiejskie, twarożek ziarnisty, cottage cheese
twarog|^Cheese, cottage, lowfat, 2% milkfat$|Twaróg (quark, semi-fat)|Twaróg półtłusty|twaróg, twarogu, twaróg półtłusty, biały ser, ser biały, twarożek, ser twarogowy, quark, farmer cheese, curd cheese
twarog-lean|^Cheese, cottage, nonfat, uncreamed, dry, large or small curd$|Twaróg (quark, lean)|Twaróg chudy|twaróg chudy, chudy twaróg, twaróg odtłuszczony, lean quark
ricotta|^Cheese, ricotta, whole milk$|Ricotta|Ricotta|ricotta, ricotty
cream-cheese|^Cheese, cream$|Cream cheese|Serek śmietankowy|serek kremowy, serek śmietankowy, philadelphia, almette, serek do smarowania, mascarpone, cream cheese
mozzarella|^Cheese, mozzarella, whole milk$|Mozzarella|Mozzarella|mozzarella, mozzarelli, mozarella, ser mozzarella
cheddar|^Cheese, cheddar \\(Includes|Cheddar|Cheddar|cheddar, cheddar cheese
parmesan|^Cheese, parmesan, hard$|Parmesan|Parmezan|parmezan, parmezanu, grana padano, parmesan
gouda|^Cheese, gouda$|Gouda|Ser żółty (gouda)|ser żółty, ser gouda, gouda, ser edamski, edamer, ser królewski, ser morski, ser tarty, tarty ser, cheese, grated cheese, edam
swiss|^Cheese, swiss$|Swiss cheese|Ser szwajcarski|ementaler, emmentaler, ser szwajcarski, swiss cheese, gruyere
feta|^Cheese, feta$|Feta|Feta|feta, fety, ser feta, ser sałatkowy, ser typu feta, bryndza, feta cheese
brie|^Cheese, brie$|Brie / camembert|Brie / camembert|brie, camembert, ser pleśniowy
blue-cheese|^Cheese, blue$|Blue cheese|Ser pleśniowy niebieski|gorgonzola, lazur, blue cheese
provolone|^Cheese, provolone$|Provolone|Provolone|provolone, oscypek
butter|^Butter, without salt$|Butter|Masło|masło, masła, masłem, butter, unsalted butter
ghee|^Butter, Clarified butter \\(ghee\\)$|Ghee|Masło klarowane|masło klarowane, ghee, clarified butter
cream-sour|^Cream, sour, cultured$|Sour cream 18%|Śmietana 18%|śmietana, śmietany, śmietana 18%, śmietana 18, kwaśna śmietana, sour cream
cream-sour-12|^Cream, sour, reduced fat, cultured$|Sour cream 12%|Śmietana 12%|śmietana 12%, śmietana 12, lekka śmietana, light sour cream
cream-30|^Cream, fluid, light whipping$|Cream 30%|Śmietanka 30%|śmietanka, śmietanka 30%, śmietanka 30, śmietanka kremówka, kremówka, śmietanka do ubijania, śmietana 30%, śmietana 30, whipping cream, cream
cream-36|^Cream, fluid, heavy whipping$|Heavy cream 36%|Śmietanka 36%|śmietanka 36%, śmietana 36%, heavy cream, double cream
cream-light|^Cream, fluid, light \\(coffee cream or table cream\\)$|Cream 12% (coffee)|Śmietanka do kawy|śmietanka do kawy, śmietanka 12%, light cream, single cream, coffee cream
cream-half|^Cream, fluid, half and half$|Half and half|Śmietanka 10%|half and half, śmietanka 10%
whipped-cream|^Cream, whipped, cream topping, pressurized$|Whipped cream (spray)|Bita śmietana|bita śmietana, whipped cream
condensed-milk|^Milk, canned, condensed, sweetened$|Sweetened condensed milk|Mleko skondensowane słodzone|mleko skondensowane, mleko zagęszczone, kajmak, condensed milk
milk-powder|^Milk, dry, whole, with added vitamin D$|Milk powder|Mleko w proszku|mleko w proszku, milk powder
whey|^Beverages, Whey protein powder isolate$|Whey protein|Odżywka białkowa (WPI)|odżywka białkowa, białko serwatkowe, whey, wpc, wpi, protein powder, scoop of protein, białko w proszku
# ---------- grains, pasta, bread ----------
rice|^Rice, white, long-grain, regular, raw, unenriched$|White rice (dry)|Ryż biały (suchy)|ryż, ryżu, ryż biały, ryż długoziarnisty, ryż basmati, basmati, ryż jaśminowy, jasmine rice, white rice, rice, long grain rice, basmati rice
rice-cooked|^Rice, white, long-grain, regular, unenriched, cooked without salt$|White rice (cooked)|Ryż biały ugotowany|ugotowany ryż, ryż ugotowany, cooked rice, boiled rice
rice-brown|^Rice, brown, long-grain, raw|Brown rice (dry)|Ryż brązowy (suchy)|ryż brązowy, ryż pełnoziarnisty, brown rice
rice-arborio|^Rice, white, medium-grain, raw, unenriched$|Risotto / sushi rice (dry)|Ryż do risotto / sushi|ryż arborio, ryż do risotto, ryż do sushi, ryż okrągłoziarnisty, arborio, sushi rice, risotto rice
rice-wild|^Wild rice, raw$|Wild rice|Ryż dziki|dziki ryż, wild rice
oats|^Cereals, oats, regular and quick, not fortified, dry$|Rolled oats|Płatki owsiane|płatki owsiane, płatków owsianych, owsianka, płatki górskie, płatki błyskawiczne, oats, rolled oats, oatmeal, porridge oats
cornflakes|^Cereals ready-to-eat, RALSTON Corn Flakes$|Corn flakes|Płatki kukurydziane|płatki kukurydziane, corn flakes, cornflakes
muesli|^Cereals ready-to-eat, granola, homemade$|Granola|Granola / musli|granola, musli, muesli, müsli
pasta|^Pasta, dry, enriched$|Pasta (dry)|Makaron (suchy)|makaron, makaronu, makaron penne, makaron spaghetti, spaghetti, penne, świderki, fusilli, tagliatelle, rurki, kokardki, nitki, lasagne, płaty lasagne, farfalle, rigatoni, pasta, noodles, linguine, macaroni
pasta-cooked|^Pasta, cooked, enriched, without added salt$|Pasta (cooked)|Makaron ugotowany|ugotowany makaron, makaron ugotowany, cooked pasta
pasta-wholewheat|^Pasta, whole-wheat, dry|Wholewheat pasta (dry)|Makaron pełnoziarnisty|makaron pełnoziarnisty, makaron razowy, wholewheat pasta, whole wheat pasta
egg-noodles|^Noodles, egg, dry, enriched$|Egg noodles (dry)|Makaron jajeczny|makaron jajeczny, egg noodles
rice-noodles|^Rice noodles, dry$|Rice noodles (dry)|Makaron ryżowy|makaron ryżowy, rice noodles, noodle
buckwheat|^Buckwheat groats, roasted, dry$|Buckwheat groats (kasza gryczana)|Kasza gryczana|kasza gryczana, kaszy gryczanej, gryczana, kasza gryczana palona, buckwheat, kasha, buckwheat groats
buckwheat-cooked|^Buckwheat groats, roasted, cooked$|Buckwheat groats (cooked)|Kasza gryczana ugotowana|ugotowana kasza gryczana, cooked buckwheat
millet|^Millet, raw$|Millet (kasza jaglana)|Kasza jaglana|kasza jaglana, kaszy jaglanej, jaglanka, jaglana, proso, millet
millet-cooked|^Millet, cooked$|Millet (cooked)|Kasza jaglana ugotowana|ugotowana kasza jaglana, cooked millet
barley|^Barley, pearled, raw$|Pearl barley (kasza jęczmienna)|Kasza jęczmienna / pęczak|kasza jęczmienna, pęczak, kasza pęczak, kasza perłowa, kasza wiejska, pearl barley, barley
barley-cooked|^Barley, pearled, cooked$|Pearl barley (cooked)|Kasza jęczmienna ugotowana|ugotowana kasza jęczmienna, cooked barley
bulgur|^Bulgur, dry$|Bulgur|Kasza bulgur|bulgur, kasza bulgur, bulgur wheat
couscous|^Couscous, dry$|Couscous (dry)|Kuskus|kuskus, kasza kuskus, couscous
quinoa|^Quinoa, uncooked$|Quinoa (dry)|Komosa ryżowa|komosa ryżowa, quinoa, kinoa
semolina|^Semolina, enriched$|Semolina (kasza manna)|Kasza manna|kasza manna, kaszy manny, manna, grysik, semolina
flour|^Wheat flour, white, all-purpose, enriched, bleached$|Wheat flour|Mąka pszenna|mąka, mąki, mąka pszenna, mąka tortowa, mąka typ 450, mąka typ 500, mąka typ 650, flour, all-purpose flour, plain flour, wheat flour, bread flour
flour-wholewheat|^Wheat flour, whole-grain \\(Includes|Wholewheat flour|Mąka pełnoziarnista|mąka pełnoziarnista, mąka razowa, mąka graham, mąka orkiszowa, mąka orkiszowa pełnoziarnista, whole wheat flour, wholemeal flour, spelt flour
flour-rye|^Rye flour, medium$|Rye flour|Mąka żytnia|mąka żytnia, rye flour
flour-corn|^Cornmeal, whole-grain, yellow$|Corn flour / polenta|Mąka kukurydziana|mąka kukurydziana, kasza kukurydziana, polenta, cornmeal, corn flour
flour-rice|^Rice flour, white, unenriched$|Rice flour|Mąka ryżowa|mąka ryżowa, rice flour
flour-almond|^Nuts, almonds, blanched$|Almond flour / blanched almonds|Mąka migdałowa|mąka migdałowa, migdały blanszowane, almond flour, ground almonds
flour-coconut|^Nuts, coconut meat, dried \\(desiccated\\), not sweetened$|Desiccated coconut|Wiórki kokosowe|wiórki kokosowe, wiórki, mąka kokosowa, kokos, desiccated coconut, shredded coconut, coconut flakes
cornstarch|^Cornstarch$|Corn starch|Skrobia kukurydziana|skrobia kukurydziana, maizena, cornstarch, corn starch, cornflour
potato-starch|^Potato flour$|Potato starch|Mąka ziemniaczana|mąka ziemniaczana, skrobia ziemniaczana, skrobia, potato starch
breadcrumbs|^Bread, crumbs, dry, grated, plain$|Breadcrumbs|Bułka tarta|bułka tarta, bułki tartej, panko, breadcrumbs, bread crumbs
bread-white|^Bread, white, commercially prepared \\(includes soft bread crumbs\\)$|White bread|Chleb pszenny|chleb, chleba, chleb pszenny, chleb biały, kromka chleba, tost, chleb tostowy, bread, white bread, toast, toast bread
bread-wholewheat|^Bread, whole-wheat, commercially prepared$|Wholewheat bread|Chleb pełnoziarnisty|chleb pełnoziarnisty, chleb razowy, chleb graham, wholewheat bread, wholemeal bread, whole wheat bread
bread-rye|^Bread, rye$|Rye bread|Chleb żytni|chleb żytni, chleb na zakwasie, rye bread, sourdough
bread-pumpernickel|^Bread, pumpernickel$|Pumpernickel|Pumpernikiel|pumpernikiel, pumpernickel
roll|^Rolls, hamburger or hotdog, plain$|Bread roll / bun|Bułka|bułka, bułki, bułka pszenna, kajzerka, bułka do burgera, bun, buns, bread roll, burger bun
baguette|^Bread, french or vienna \\(includes sourdough\\)$|Baguette|Bagietka|bagietka, bagietki, baguette, french bread, ciabatta
bagel|^Bagels, plain, enriched, with calcium propionate \\(includes onion, poppy, sesame\\)$|Bagel|Bajgiel|bajgiel, obwarzanek, bagel
tortilla|^Tortillas, ready-to-bake or -fry, flour, refrigerated$|Flour tortilla|Tortilla pszenna|tortilla, tortille, tortilli, placek tortilla, wrap, wrapy, tortilla wrap, flour tortilla, wraps
tortilla-corn|^Tortillas, ready-to-bake or -fry, corn$|Corn tortilla|Tortilla kukurydziana|tortilla kukurydziana, corn tortilla, taco shell
pita|^Bread, pita, white, enriched$|Pita|Pita|pita, pity, chlebek pita, pita bread
crispbread|^Crackers, rye, wafers, plain$|Crispbread|Pieczywo chrupkie|pieczywo chrupkie, wasa, crispbread
rice-cakes|^Snacks, rice cakes, brown rice, plain|Rice cakes|Wafle ryżowe|wafle ryżowe, wafel ryżowy, rice cakes, rice cake
puff-pastry|^Puff pastry, frozen, ready-to-bake$|Puff pastry|Ciasto francuskie|ciasto francuskie, puff pastry
yeast|^Leavening agents, yeast, baker's, compressed$|Fresh yeast|Drożdże|drożdże, drożdży, drożdże świeże, fresh yeast, yeast
yeast-dry|^Leavening agents, yeast, baker's, active dry$|Dry yeast|Drożdże suszone|drożdże suszone, drożdże instant, dry yeast, instant yeast
baking-powder|^Leavening agents, baking powder, double-acting, sodium aluminum sulfate$|Baking powder|Proszek do pieczenia|proszek do pieczenia, proszku do pieczenia, baking powder
baking-soda|^Leavening agents, baking soda$|Baking soda|Soda oczyszczona|soda, soda oczyszczona, sody, baking soda, bicarbonate of soda
# ---------- potatoes & vegetables ----------
potato|^Potatoes, flesh and skin, raw$|Potatoes|Ziemniaki|ziemniak, ziemniaki, ziemniaków, kartofle, młode ziemniaki, potato, potatoes, baby potatoes
potato-boiled|^Potatoes, boiled, cooked without skin, flesh, without salt$|Potatoes (boiled)|Ziemniaki gotowane|ugotowane ziemniaki, ziemniaki gotowane, boiled potatoes
sweet-potato|^Sweet potato, raw, unprepared|Sweet potato|Batat|batat, bataty, batatów, słodki ziemniak, słodkie ziemniaki, sweet potato, sweet potatoes, yam
fries|^Potatoes, french fried, all types, salt added in processing, frozen, unprepared$|Frozen fries|Frytki mrożone|frytki, frytek, frozen fries, fries, french fries, chips
onion|^Onions, raw$|Onion|Cebula|cebula, cebuli, cebule, cebulka, cebulki, cebula biała, cebula żółta, cebula czerwona, czerwona cebula, szalotka, szalotki, onion, onions, red onion, shallot, shallots, yellow onion
spring-onion|^Onions, spring or scallions \\(includes tops and bulb\\), raw$|Spring onion|Dymka / szczypiorek|dymka, cebulka dymka, szczypiorek, szczypiorku, spring onion, spring onions, scallion, scallions, green onion, green onions, chives
garlic|^Garlic, raw$|Garlic|Czosnek|czosnek, czosnku, ząbek czosnku, ząbki czosnku, główka czosnku, garlic, garlic clove, garlic cloves, cloves garlic
carrot|^Carrots, raw$|Carrot|Marchew|marchew, marchewka, marchewki, marchwi, marchewek, carrot, carrots
tomato|^Tomatoes, red, ripe, raw, year round average$|Tomato|Pomidor|pomidor, pomidory, pomidora, pomidorów, pomidorki, pomidorki koktajlowe, pomidorki cherry, tomato, tomatoes, cherry tomatoes
tomato-canned|^Tomatoes, red, ripe, canned, packed in tomato juice$|Canned tomatoes|Pomidory z puszki|pomidory z puszki, pomidory krojone, pomidory w puszce, pomidory pelati, krojone pomidory, canned tomatoes, chopped tomatoes, diced tomatoes, tinned tomatoes
tomato-puree|^Tomato products, canned, puree, without salt added$|Passata / tomato purée|Passata|passata, przecier pomidorowy, przecier, pulpa pomidorowa, tomato puree, tomato passata, crushed tomatoes
tomato-paste|^Tomato products, canned, paste, without salt added|Tomato paste|Koncentrat pomidorowy|koncentrat pomidorowy, koncentratu pomidorowego, koncentrat, tomato paste, tomato concentrate
tomato-sauce|^Tomato products, canned, sauce$|Tomato sauce|Sos pomidorowy|sos pomidorowy, tomato sauce, marinara, pasta sauce
sun-dried-tomato|^Tomatoes, sun-dried, packed in oil, drained$|Sun-dried tomatoes|Suszone pomidory|suszone pomidory, pomidory suszone, sun-dried tomatoes, sundried tomatoes
cucumber|^Cucumber, with peel, raw$|Cucumber|Ogórek|ogórek, ogórki, ogórka, ogórek zielony, ogórek szklarniowy, cucumber, cucumbers
pickle|^Pickles, cucumber, dill or kosher dill$|Pickled cucumber|Ogórek kiszony|ogórek kiszony, ogórki kiszone, ogórek konserwowy, ogórki konserwowe, korniszony, pickles, pickle, gherkins, dill pickle
pepper-red|^Peppers, sweet, red, raw$|Red bell pepper|Papryka czerwona|papryka, papryki, papryka czerwona, czerwona papryka, papryka żółta, żółta papryka, bell pepper, red pepper, peppers, yellow pepper, red bell pepper
pepper-green|^Peppers, sweet, green, raw$|Green bell pepper|Papryka zielona|zielona papryka, papryka zielona, green pepper, green bell pepper
chili|^Peppers, hot chili, red, raw$|Chili pepper|Papryczka chili|chili, papryczka chili, papryczki chili, jalapeño, jalapeno, chilli, chili pepper, red chili, chile
zucchini|^Squash, summer, zucchini, includes skin, raw$|Zucchini / courgette|Cukinia|cukinia, cukinii, cukinie, zucchini, courgette, courgettes
eggplant|^Eggplant, raw$|Eggplant / aubergine|Bakłażan|bakłażan, bakłażana, bakłażany, oberżyna, eggplant, aubergine
broccoli|^Broccoli, raw$|Broccoli|Brokuł|brokuł, brokuły, brokułu, brokułów, broccoli
cauliflower|^Cauliflower, raw$|Cauliflower|Kalafior|kalafior, kalafiora, cauliflower
cabbage|^Cabbage, raw$|Cabbage|Kapusta biała|kapusta, kapusty, kapusta biała, kapusta włoska, kapusta pekińska, cabbage, white cabbage, savoy cabbage, chinese cabbage
cabbage-red|^Cabbage, red, raw$|Red cabbage|Kapusta czerwona|kapusta czerwona, czerwona kapusta, red cabbage
sauerkraut|^Sauerkraut, canned, solids and liquids$|Sauerkraut|Kapusta kiszona|kapusta kiszona, kiszona kapusta, kapusty kiszonej, sauerkraut
spinach|^Spinach, raw$|Spinach|Szpinak|szpinak, szpinaku, baby szpinak, młody szpinak, liście szpinaku, spinach, baby spinach
lettuce|^Lettuce, green leaf, raw$|Lettuce|Sałata|sałata, sałaty, sałata masłowa, mix sałat, sałata rzymska, rzymska, roszponka, lettuce, salad leaves, mixed greens, romaine, lamb's lettuce
iceberg|^Lettuce, iceberg \\(includes crisphead types\\), raw$|Iceberg lettuce|Sałata lodowa|sałata lodowa, lodowa, iceberg, iceberg lettuce
arugula|^Arugula, raw$|Rocket / arugula|Rukola|rukola, rukoli, rukolę, rokietta, arugula, rocket
kale|^Kale, raw$|Kale|Jarmuż|jarmuż, jarmużu, kale
mushrooms|^Mushrooms, white, raw$|Mushrooms|Pieczarki|pieczarka, pieczarki, pieczarek, grzyby, grzybów, boczniaki, mushroom, mushrooms, button mushrooms, champignons
mushrooms-dried|^Mushrooms, shiitake, dried$|Dried mushrooms|Grzyby suszone|suszone grzyby, grzyby suszone, dried mushrooms, porcini
celery|^Celery, raw$|Celery (stalks)|Seler naciowy|seler naciowy, selera naciowego, łodyga selera, celery, celery stalk, celery stalks
celeriac|^Celeriac, raw$|Celeriac|Seler korzeniowy|seler, selera, seler korzeniowy, celeriac, celery root
leek|^Leeks, \\(bulb and lower leaf-portion\\), raw$|Leek|Por|por, pora, pory, leek, leeks
parsley-root|^Parsnips, raw$|Parsley root / parsnip|Pietruszka (korzeń)|pietruszka, pietruszki, korzeń pietruszki, pasternak, parsnip, parsnips, parsley root
parsley|^Parsley, fresh$|Parsley (leaves)|Natka pietruszki|natka pietruszki, natki pietruszki, natka, pietruszka natka, parsley, fresh parsley, flat-leaf parsley
dill|^Dill weed, fresh$|Dill|Koperek|koperek, koperku, koper, dill, fresh dill
coriander|^Coriander \\(cilantro\\) leaves, raw$|Coriander / cilantro|Kolendra (świeża)|kolendra, świeża kolendra, kolendry, cilantro, coriander, fresh coriander
basil-fresh|^Basil, fresh$|Basil (fresh)|Bazylia świeża|bazylia, bazylii, świeża bazylia, liście bazylii, basil, fresh basil, basil leaves
mint|^Spearmint, fresh$|Mint|Mięta|mięta, mięty, listki mięty, mint, fresh mint
beet|^Beets, raw$|Beetroot|Burak|burak, buraki, buraczki, buraków, beetroot, beetroots, beet, beets
radish|^Radishes, raw$|Radish|Rzodkiewka|rzodkiewka, rzodkiewki, rzodkiewek, radish, radishes
peas|^Peas, green, frozen, unprepared|Green peas|Groszek|groszek, groszek zielony, groszku, zielony groszek, groszek mrożony, peas, green peas, frozen peas
peas-canned|^Peas, green \\(includes baby|Canned peas|Groszek konserwowy|groszek konserwowy, groszek z puszki, canned peas
corn|^Corn, sweet, yellow, canned, whole kernel, drained solids$|Sweet corn (canned)|Kukurydza konserwowa|kukurydza, kukurydzy, kukurydza konserwowa, kukurydza z puszki, sweetcorn, sweet corn, corn, canned corn
corn-cob|^Corn, sweet, yellow, raw$|Corn on the cob|Kolba kukurydzy|kolba kukurydzy, kolby kukurydzy, corn on the cob
green-beans|^Beans, snap, green, raw$|Green beans|Fasolka szparagowa|fasolka szparagowa, fasolki szparagowej, fasolka, green beans, string beans
asparagus|^Asparagus, raw$|Asparagus|Szparagi|szparagi, szparagów, szparag, asparagus
brussels|^Brussels sprouts, raw$|Brussels sprouts|Brukselka|brukselka, brukselki, brussels sprouts
pumpkin|^Pumpkin, raw$|Pumpkin|Dynia|dynia, dyni, dynia hokkaido, butternut, dynia piżmowa, pumpkin, squash, butternut squash
kohlrabi|^Kohlrabi, raw$|Kohlrabi|Kalarepa|kalarepa, kalarepy, kohlrabi
avocado|^Avocados, raw, all commercial varieties$|Avocado|Awokado|awokado, avocado, avocados
olives|^Olives, ripe, canned \\(small-extra large\\)$|Olives|Oliwki|oliwki, oliwek, oliwka, oliwki czarne, oliwki zielone, olives, black olives, green olives, kalamata
ginger|^Ginger root, raw$|Ginger (fresh)|Imbir świeży|imbir, imbiru, świeży imbir, korzeń imbiru, ginger, fresh ginger, ginger root
horseradish|^Horseradish, prepared$|Horseradish|Chrzan|chrzan, chrzanu, horseradish
fennel|^Fennel, bulb, raw$|Fennel|Koper włoski|koper włoski, fenkuł, fennel
bok-choy|^Cabbage, chinese \\(pak-choi\\), raw$|Pak choi|Pak choi|pak choi, bok choy, pak-choi
sprouts|^Mung beans, mature seeds, sprouted, raw$|Bean sprouts|Kiełki|kiełki, kiełków, kiełki fasoli mung, bean sprouts, sprouts
mixed-veg|^Vegetables, mixed, frozen, unprepared$|Mixed vegetables (frozen)|Mieszanka warzyw|mieszanka warzyw, mrożone warzywa, warzywa mrożone, warzywa na patelnię, włoszczyzna, mixed vegetables, frozen vegetables, stir fry vegetables
# ---------- legumes & soy ----------
chickpeas|^Chickpeas \\(garbanzo beans, bengal gram\\), mature seeds, canned, drained, rinsed in tap water$|Chickpeas (canned)|Ciecierzyca z puszki|ciecierzyca, cieciorka, ciecierzycy, ciecierzyca z puszki, cieciorka konserwowa, chickpeas, garbanzo, garbanzo beans, canned chickpeas
chickpeas-dry|^Chickpeas \\(garbanzo beans, bengal gram\\), mature seeds, raw$|Chickpeas (dry)|Ciecierzyca sucha|sucha ciecierzyca, dried chickpeas
lentils-red|^Lentils, pink or red, raw$|Red lentils (dry)|Soczewica czerwona|soczewica, soczewicy, soczewica czerwona, czerwona soczewica, red lentils, lentils
lentils|^Lentils, raw$|Green/brown lentils (dry)|Soczewica zielona|soczewica zielona, soczewica brązowa, zielona soczewica, green lentils, brown lentils
lentils-cooked|^Lentils, mature seeds, cooked, boiled, without salt$|Lentils (cooked)|Soczewica ugotowana|ugotowana soczewica, cooked lentils
beans-red|^Beans, kidney, red, mature seeds, canned, drained solids$|Kidney beans (canned)|Fasola czerwona z puszki|fasola, fasoli, fasola czerwona, czerwona fasola, fasola z puszki, fasola konserwowa, kidney beans, red kidney beans, beans
beans-white|^Beans, white, mature seeds, canned$|White beans (canned)|Fasola biała z puszki|fasola biała, biała fasola, fasola jaś, jaś, cannellini, white beans, butter beans, navy beans, cannellini beans
beans-white-dry|^Beans, white, mature seeds, raw$|White beans (dry)|Fasola biała sucha|sucha fasola, fasola sucha, dried beans
beans-black|^Beans, black, mature seeds, canned, low sodium$|Black beans (canned)|Fasola czarna|fasola czarna, czarna fasola, black beans
baked-beans|^Beans, baked, canned, plain or vegetarian$|Baked beans|Fasolka po bretońsku (puszka)|fasolka w sosie pomidorowym, baked beans
split-peas|^Peas, split, mature seeds, cooked, boiled, without salt$|Split peas (cooked)|Groch łuskany ugotowany|groch, grochu, groch łuskany, split peas
soybeans|^Soybeans, mature seeds, raw$|Soybeans (dry)|Soja|soja, soi, soybeans
edamame|^Edamame, frozen, unprepared$|Edamame|Edamame|edamame, fasolka edamame
tofu|^Tofu, raw, firm, prepared with calcium sulfate$|Tofu (firm)|Tofu|tofu, tofu naturalne, tofu twarde, tofu wędzone, tofu kostka, firm tofu, smoked tofu
tofu-silken|^Tofu, soft, prepared with calcium sulfate and magnesium chloride \\(nigari\\)$|Silken tofu|Tofu jedwabiste|tofu jedwabiste, silken tofu, soft tofu
tempeh|^Tempeh$|Tempeh|Tempeh|tempeh
hummus|^Hummus, commercial$|Hummus|Hummus|hummus, humus, houmous
# ---------- fruit ----------
apple|^Apples, raw, with skin \\(Includes foods for USDA's Food Distribution Program\\)$|Apple|Jabłko|jabłko, jabłka, jabłek, jabłuszko, apple, apples
banana|^Bananas, raw$|Banana|Banan|banan, banany, banana, bananów, banana, bananas
orange|^Oranges, raw, all commercial varieties$|Orange|Pomarańcza|pomarańcza, pomarańcze, pomarańczy, orange, oranges
mandarin|^Tangerines, \\(mandarin oranges\\), raw$|Mandarin|Mandarynka|mandarynka, mandarynki, mandarynek, klementynka, klementynki, mandarin, tangerine, clementine
lemon|^Lemons, raw, without peel$|Lemon|Cytryna|cytryna, cytryny, cytryn, lemon, lemons
lemon-juice|^Lemon juice, raw$|Lemon juice|Sok z cytryny|sok z cytryny, soku z cytryny, sok cytrynowy, lemon juice, juice of lemon
lime|^Limes, raw$|Lime|Limonka|limonka, limonki, limonek, sok z limonki, lime, limes, lime juice
grapefruit|^Grapefruit, raw, pink and red, all areas$|Grapefruit|Grejpfrut|grejpfrut, grejpfruta, grapefruit
strawberries|^Strawberries, raw$|Strawberries|Truskawki|truskawka, truskawki, truskawek, strawberry, strawberries
blueberries|^Blueberries, raw$|Blueberries|Borówki|borówki, borówka, borówek, borówka amerykańska, jagody, jagód, blueberry, blueberries
raspberries|^Raspberries, raw$|Raspberries|Maliny|malina, maliny, malin, raspberry, raspberries
blackberries|^Blackberries, raw$|Blackberries|Jeżyny|jeżyny, jeżyn, blackberries
berries-frozen|^Strawberries, frozen, unsweetened|Frozen berries|Owoce leśne mrożone|owoce leśne, mrożone owoce, owoce mrożone, mieszanka owoców, frozen berries, mixed berries, frozen fruit
cherries|^Cherries, sweet, raw$|Cherries|Czereśnie|czereśnie, czereśni, cherries
sour-cherries|^Cherries, sour, red, raw$|Sour cherries|Wiśnie|wiśnie, wiśni, wiśnia, sour cherries
grapes|^Grapes, red or green \\(European type, such as Thompson seedless\\), raw$|Grapes|Winogrona|winogrona, winogron, winogrono, grapes
pear|^Pears, raw$|Pear|Gruszka|gruszka, gruszki, gruszek, pear, pears
peach|^Peaches, yellow, raw$|Peach|Brzoskwinia|brzoskwinia, brzoskwinie, brzoskwiń, nektarynka, nektarynki, peach, peaches, nectarine
peach-canned|^Peaches, canned, heavy syrup pack, solids and liquids$|Canned peaches|Brzoskwinie z puszki|brzoskwinie z puszki, brzoskwinie w syropie, canned peaches
plum|^Plums, raw$|Plum|Śliwka|śliwka, śliwki, śliwek, plum, plums
apricot|^Apricots, raw$|Apricot|Morela|morela, morele, moreli, apricot, apricots
kiwi|^Kiwifruit, green, raw$|Kiwi|Kiwi|kiwi
mango|^Mangos, raw$|Mango|Mango|mango
pineapple|^Pineapple, raw, all varieties$|Pineapple|Ananas|ananas, ananasa, ananasy, pineapple
pineapple-canned|^Pineapple, canned, juice pack, solids and liquids$|Canned pineapple|Ananas z puszki|ananas z puszki, canned pineapple
watermelon|^Watermelon, raw$|Watermelon|Arbuz|arbuz, arbuza, watermelon
melon|^Melons, cantaloupe, raw$|Melon|Melon|melon, melona, cantaloupe
pomegranate|^Pomegranates, raw$|Pomegranate|Granat|granat, granatu, pestki granatu, pomegranate, pomegranate seeds
rhubarb|^Rhubarb, raw$|Rhubarb|Rabarbar|rabarbar, rabarbaru, rhubarb
cranberries-dried|^Cranberries, dried, sweetened|Dried cranberries|Żurawina suszona|żurawina, żurawiny, suszona żurawina, dried cranberries, craisins
raisins|^Raisins, dark, seedless|Raisins|Rodzynki|rodzynki, rodzynek, rodzynkami, raisins, sultanas
dates|^Dates, medjool$|Dates|Daktyle|daktyle, daktyli, daktyl, dates, medjool dates
apricots-dried|^Apricots, dried, sulfured, uncooked$|Dried apricots|Morele suszone|suszone morele, morele suszone, dried apricots
prunes|^Plums, dried \\(prunes\\), uncooked$|Prunes|Śliwki suszone|suszone śliwki, śliwki suszone, prunes
figs-dried|^Figs, dried, uncooked$|Dried figs|Figi suszone|figi, figi suszone, suszone figi, figs
coconut-milk|^Nuts, coconut milk, canned \\(liquid expressed from grated meat and water\\)$|Coconut milk|Mleczko kokosowe|mleczko kokosowe, mleko kokosowe, mleczka kokosowego, coconut milk, coconut cream
applesauce|^Applesauce, canned, unsweetened, without added ascorbic acid \\(Includes foods for USDA's Food Distribution Program\\)$|Apple sauce|Mus jabłkowy|mus jabłkowy, przecier jabłkowy, prażone jabłka, applesauce, apple sauce
# ---------- nuts & seeds ----------
almonds|^Nuts, almonds$|Almonds|Migdały|migdały, migdałów, płatki migdałowe, almonds, flaked almonds, sliced almonds
walnuts|^Nuts, walnuts, english$|Walnuts|Orzechy włoskie|orzechy włoskie, orzechów włoskich, orzechy, orzechów, walnuts, nuts
hazelnuts|^Nuts, hazelnuts or filberts$|Hazelnuts|Orzechy laskowe|orzechy laskowe, orzechów laskowych, hazelnuts
cashews|^Nuts, cashew nuts, raw$|Cashews|Orzechy nerkowca|nerkowce, orzechy nerkowca, nerkowca, cashews, cashew nuts
pistachios|^Nuts, pistachio nuts, raw$|Pistachios|Pistacje|pistacje, pistacji, pistachios
peanuts|^Peanuts, all types, raw$|Peanuts|Orzeszki ziemne|orzeszki ziemne, orzeszki arachidowe, orzeszki, fistaszki, peanuts
peanuts-roasted|^Peanuts, all types, dry-roasted, without salt$|Roasted peanuts|Orzeszki prażone|orzeszki prażone, roasted peanuts
peanut-butter|^Peanut butter, smooth style, without salt$|Peanut butter|Masło orzechowe|masło orzechowe, masła orzechowego, peanut butter
pecans|^Nuts, pecans$|Pecans|Orzechy pekan|pekan, orzechy pekan, pecans
macadamia|^Nuts, macadamia nuts, raw$|Macadamia nuts|Orzechy makadamia|makadamia, macadamia
brazil-nuts|^Nuts, brazilnuts, dried, unblanched$|Brazil nuts|Orzechy brazylijskie|orzechy brazylijskie, brazil nuts
sunflower-seeds|^Seeds, sunflower seed kernels, dried$|Sunflower seeds|Słonecznik (pestki)|słonecznik, pestki słonecznika, ziarna słonecznika, sunflower seeds
pumpkin-seeds|^Seeds, pumpkin and squash seed kernels, dried$|Pumpkin seeds|Pestki dyni|pestki dyni, pestek dyni, pumpkin seeds, pepitas
chia|^Seeds, chia seeds, dried$|Chia seeds|Nasiona chia|chia, nasiona chia, nasion chia, chia seeds
flaxseed|^Seeds, flaxseed$|Flaxseed|Siemię lniane|siemię lniane, siemienia lnianego, len, flaxseed, linseed, flax seeds
sesame|^Seeds, sesame seeds, whole, dried$|Sesame seeds|Sezam|sezam, sezamu, ziarna sezamu, sesame, sesame seeds
tahini|^Seeds, sesame butter, tahini, from roasted and toasted kernels \\(most common type\\)$|Tahini|Tahini (pasta sezamowa)|tahini, tahina, pasta sezamowa, tahini paste
poppy-seeds|^Spices, poppy seed$|Poppy seeds|Mak|mak, maku, masa makowa, poppy seeds
# ---------- oils & fats ----------
olive-oil|^Oil, olive, salad or cooking$|Olive oil|Oliwa z oliwek|oliwa, oliwy, oliwa z oliwek, oliwa extra virgin, olive oil, extra virgin olive oil, evoo
oil|^Oil, canola$|Rapeseed / canola oil|Olej rzepakowy|olej, oleju, olej rzepakowy, olej roślinny, oil, vegetable oil, canola oil, rapeseed oil, cooking oil
sunflower-oil|^Oil, sunflower, linoleic, \\(approx. 65%\\)$|Sunflower oil|Olej słonecznikowy|olej słonecznikowy, sunflower oil
coconut-oil|^Oil, coconut$|Coconut oil|Olej kokosowy|olej kokosowy, coconut oil
sesame-oil|^Oil, sesame, salad or cooking$|Sesame oil|Olej sezamowy|olej sezamowy, sesame oil
cooking-spray|^Oil, olive, salad or cooking$|Oil spray|Olej w sprayu|olej w sprayu, cooking spray, oil spray
margarine|^Margarine, regular, 80% fat, composite, stick, without salt$|Margarine|Margaryna|margaryna, margaryny, margarine, stork, kasia, palma
mayonnaise|^Salad dressing, mayonnaise, regular$|Mayonnaise|Majonez|majonez, majonezu, mayonnaise, mayo
mayonnaise-light|^Salad dressing, mayonnaise, light$|Light mayonnaise|Majonez light|majonez light, light mayonnaise, light mayo
# ---------- sweeteners, baking, sweets ----------
sugar|^Sugars, granulated$|Sugar|Cukier|cukier, cukru, cukier biały, cukier kryształ, sugar, white sugar, caster sugar, granulated sugar
sugar-brown|^Sugars, brown$|Brown sugar|Cukier brązowy|cukier brązowy, cukier trzcinowy, brown sugar, cane sugar
sugar-powdered|^Sugars, powdered$|Icing sugar|Cukier puder|cukier puder, cukru pudru, icing sugar, powdered sugar
vanilla-sugar|^Sugars, granulated$|Vanilla sugar|Cukier waniliowy|cukier waniliowy, cukier wanilinowy, cukru waniliowego, vanilla sugar
honey|^Honey$|Honey|Miód|miód, miodu, miodem, honey
maple-syrup|^Syrups, maple$|Maple syrup|Syrop klonowy|syrop klonowy, syrop z agawy, syrop, agawa, maple syrup, agave syrup, agave, syrup
jam|^Jams and preserves$|Jam|Dżem|dżem, dżemu, konfitura, powidła, marmolada, jam, preserves, jelly
chocolate-dark|^Chocolate, dark, 70-85% cacao solids$|Dark chocolate 70-85%|Czekolada gorzka|czekolada gorzka, gorzka czekolada, czekolada deserowa, czekolady, czekolada, dark chocolate, chocolate
chocolate-milk|^Candies, milk chocolate$|Milk chocolate|Czekolada mleczna|czekolada mleczna, mleczna czekolada, milk chocolate
chocolate-white|^Candies, white chocolate$|White chocolate|Czekolada biała|biała czekolada, czekolada biała, white chocolate
chocolate-chips|^Candies, semisweet chocolate$|Chocolate chips|Kawałki czekolady|kropelki czekoladowe, chocolate chips
cocoa|^Cocoa, dry powder, unsweetened$|Cocoa powder|Kakao|kakao, kakaa, kakao naturalne, cocoa, cocoa powder, cacao
nutella|^Chocolate-flavored hazelnut spread$|Chocolate hazelnut spread|Krem czekoladowo-orzechowy|nutella, nutelli, krem czekoladowy, krem orzechowy, chocolate spread, hazelnut spread
gelatin|^Gelatins, dry powder, unsweetened$|Gelatin|Żelatyna|żelatyna, żelatyny, gelatin, gelatine
jelly-dessert|^Gelatin desserts, dry mix$|Jelly dessert mix|Galaretka (proszek)|galaretka, galaretki, jelly, jello
pudding-mix|^Puddings, vanilla, dry mix, regular$|Pudding mix|Budyń (proszek)|budyń, budyniu, pudding, custard powder
vanilla-extract|^Vanilla extract$|Vanilla extract|Ekstrakt waniliowy|ekstrakt waniliowy, aromat waniliowy, wanilia, laska wanilii, vanilla, vanilla extract, vanilla essence
biscuits|^Cookies, butter, commercially prepared, enriched$|Butter biscuits|Herbatniki|herbatniki, herbatników, biszkopty, ciastka, ciasteczka, petitki, biscuits, cookies, sponge fingers, ladyfingers
oreo|^Cookies, chocolate sandwich, with creme filling, regular$|Chocolate sandwich cookies|Ciastka oreo|oreo, markizy, sandwich cookies
ice-cream|^Ice creams, vanilla$|Vanilla ice cream|Lody waniliowe|lody, lodów, lody waniliowe, gałka lodów, ice cream
marshmallows|^Candies, marshmallows$|Marshmallows|Pianki|pianki, marshmallows
# ---------- sauces, condiments, stock ----------
ketchup|^Catsup$|Ketchup|Ketchup|ketchup, keczup, ketchupu
mustard|^Mustard, prepared, yellow$|Mustard|Musztarda|musztarda, musztardy, musztarda dijon, musztarda francuska, dijon, mustard, dijon mustard, wholegrain mustard
soy-sauce|^Soy sauce made from soy and wheat \\(shoyu\\)$|Soy sauce|Sos sojowy|sos sojowy, sosu sojowego, soy sauce, tamari
vinegar|^Vinegar, distilled$|Vinegar|Ocet|ocet, octu, ocet spirytusowy, ocet jabłkowy, ocet winny, ocet ryżowy, vinegar, apple cider vinegar, white vinegar, rice vinegar, wine vinegar
balsamic|^Vinegar, balsamic$|Balsamic vinegar|Ocet balsamiczny|ocet balsamiczny, krem balsamiczny, balsamic, balsamic vinegar
worcestershire|^Sauce, worcestershire$|Worcestershire sauce|Sos Worcestershire|sos worcestershire, worcestershire
hot-sauce|^Sauce, hot chile, sriracha$|Sriracha / hot sauce|Sos sriracha|sriracha, sos sriracha, sos chili, ostry sos, tabasco, hot sauce, chili sauce
sweet-chili|^Sauce, sweet and sour, prepared-from-recipe$|Sweet chili / sweet & sour sauce|Sos słodko-kwaśny|sos słodko-kwaśny, sos słodkie chili, sweet chili sauce, sweet and sour sauce
bbq-sauce|^Sauce, barbecue$|BBQ sauce|Sos barbecue|sos bbq, sos barbecue, bbq sauce, barbecue sauce
teriyaki|^Sauce, teriyaki, ready-to-serve$|Teriyaki sauce|Sos teriyaki|sos teriyaki, teriyaki, teriyaki sauce
oyster-sauce|^Sauce, oyster, ready-to-serve$|Oyster sauce|Sos ostrygowy|sos ostrygowy, oyster sauce
fish-sauce|^Sauce, fish, ready-to-serve$|Fish sauce|Sos rybny|sos rybny, fish sauce
pesto|^Sauce, pesto, ready-to-serve, refrigerated$|Pesto|Pesto|pesto, pesto bazyliowe, pesto genovese
salsa|^Sauce, salsa, ready-to-serve$|Salsa|Salsa|salsa, sos salsa
garlic-sauce|^Salad dressing, ranch dressing, regular$|Garlic / ranch sauce|Sos czosnkowy|sos czosnkowy, sos ranch, ranch, garlic sauce
vinaigrette|^Salad dressing, italian dressing, commercial, regular$|Salad dressing|Sos winegret|winegret, vinaigrette, sos vinaigrette, dressing, salad dressing
broth-chicken|^Soup, chicken broth, ready-to-serve$|Chicken stock|Bulion drobiowy|bulion, bulionu, rosół, rosołu, wywar, bulion drobiowy, bulion z kurczaka, stock, broth, chicken stock, chicken broth
broth-veg|^Soup, vegetable broth, ready to serve$|Vegetable stock|Bulion warzywny|bulion warzywny, wywar warzywny, vegetable stock, vegetable broth
broth-beef|^Soup, beef broth or bouillon canned, ready-to-serve$|Beef stock|Bulion wołowy|bulion wołowy, beef stock, beef broth
bouillon|^Soup, bouillon cubes and granules, low sodium, dry$|Stock cube|Kostka rosołowa|kostka rosołowa, kostki rosołowej, kostka bulionowa, stock cube, bouillon cube, bouillon
gravy|^Gravy, brown, dry$|Gravy mix|Sos pieczeniowy (proszek)|sos pieczeniowy, gravy
curry-paste|^Spices, curry powder$|Curry paste / powder|Pasta curry|pasta curry, czerwona pasta curry, zielona pasta curry, curry paste, red curry paste, green curry paste
# ---------- spices & herbs ----------
salt|^Salt, table$|Salt|Sól|sól, soli, szczypta soli, sól morska, sól himalajska, salt, sea salt, kosher salt
pepper|^Spices, pepper, black$|Black pepper|Pieprz|pieprz, pieprzu, pieprz czarny, czarny pieprz, pepper, black pepper, ground pepper, salt and pepper, sól i pieprz
paprika|^Spices, paprika$|Paprika (ground)|Papryka słodka mielona|papryka słodka, papryka mielona, papryka wędzona, słodka papryka, papryka ostra, ostra papryka, wędzona papryka, paprika, smoked paprika, sweet paprika
chili-powder|^Spices, chili powder$|Chili powder|Chili w proszku|chili w proszku, płatki chili, chili mielone, chili powder, chili flakes, red pepper flakes
cayenne|^Spices, pepper, red or cayenne$|Cayenne pepper|Pieprz cayenne|pieprz cayenne, cayenne, kajeński
cinnamon|^Spices, cinnamon, ground$|Cinnamon|Cynamon|cynamon, cynamonu, cinnamon
cumin|^Spices, cumin seed$|Cumin|Kumin|kumin, kmin rzymski, kminu rzymskiego, kminek, cumin, ground cumin, caraway
oregano|^Spices, oregano, dried$|Oregano (dried)|Oregano|oregano, zioła prowansalskie, przyprawa włoska, italian seasoning, herbes de provence, mixed herbs, dried herbs
basil-dried|^Spices, basil, dried$|Basil (dried)|Bazylia suszona|bazylia suszona, suszona bazylia, dried basil
thyme|^Spices, thyme, dried$|Thyme|Tymianek|tymianek, tymianku, thyme
rosemary|^Spices, rosemary, dried$|Rosemary|Rozmaryn|rozmaryn, rozmarynu, rosemary
marjoram|^Spices, marjoram, dried$|Marjoram|Majeranek|majeranek, majeranku, marjoram
bay-leaf|^Spices, bay leaf$|Bay leaf|Liść laurowy|liść laurowy, liście laurowe, listek laurowy, bay leaf, bay leaves
allspice|^Spices, allspice, ground$|Allspice|Ziele angielskie|ziele angielskie, ziela angielskiego, allspice
curry|^Spices, curry powder$|Curry powder|Curry (przyprawa)|curry, przyprawa curry, curry powder, garam masala
turmeric|^Spices, turmeric, ground$|Turmeric|Kurkuma|kurkuma, kurkumy, turmeric
nutmeg|^Spices, nutmeg, ground$|Nutmeg|Gałka muszkatołowa|gałka muszkatołowa, gałki muszkatołowej, nutmeg
garlic-powder|^Spices, garlic powder$|Garlic powder|Czosnek granulowany|czosnek granulowany, czosnek w proszku, czosnek suszony, garlic powder, granulated garlic
onion-powder|^Spices, onion powder$|Onion powder|Cebula suszona|cebula granulowana, cebula suszona, onion powder
ginger-ground|^Spices, ginger, ground$|Ground ginger|Imbir mielony|imbir mielony, ground ginger
coriander-seed|^Spices, coriander seed$|Coriander seed|Kolendra mielona|kolendra mielona, ziarna kolendry, ground coriander, coriander seed
cloves|^Spices, cloves, ground$|Cloves|Goździki|goździki, goździków, cloves
cardamom|^Spices, cardamom$|Cardamom|Kardamon|kardamon, cardamom
dill-dried|^Spices, dill weed, dried$|Dill (dried)|Koperek suszony|koperek suszony, dried dill
parsley-dried|^Spices, parsley, dried$|Parsley (dried)|Pietruszka suszona|pietruszka suszona, suszona natka, dried parsley
vegeta|^Soup, bouillon cubes and granules, low sodium, dry$|Seasoning (Vegeta)|Przyprawa do potraw (Vegeta)|vegeta, przyprawa warzywna, jarzynka, przyprawa do potraw, przyprawa do kurczaka, przyprawa do mięs, przyprawa gyros, przyprawa, przyprawy, seasoning, all-purpose seasoning, spice mix
# ---------- drinks ----------
water|^Beverages, water, tap, drinking$|Water|Woda|woda, wody, wodą, ciepła woda, zimna woda, wrzątek, water, hot water, cold water, boiling water
coffee|^Beverages, coffee, brewed, prepared with tap water$|Coffee (black)|Kawa czarna|kawa, kawy, espresso, kawa czarna, coffee, black coffee
tea|^Beverages, tea, black, brewed, prepared with tap water$|Tea|Herbata|herbata, herbaty, tea
orange-juice|^Orange juice, raw|Orange juice|Sok pomarańczowy|sok pomarańczowy, sok z pomarańczy, orange juice
apple-juice|^Apple juice, canned or bottled, unsweetened, without added ascorbic acid$|Apple juice|Sok jabłkowy|sok jabłkowy, sok, soku, apple juice, juice
cola|^Beverages, carbonated, cola, regular$|Cola|Cola|cola, coca-cola, pepsi, napój gazowany, coke, soda
beer|^Alcoholic beverage, beer, regular, all$|Beer|Piwo|piwo, piwa, beer, lager
wine-red|^Alcoholic beverage, wine, table, red$|Red wine|Wino czerwone|wino, wina, czerwone wino, wino czerwone, wytrawne wino, red wine, wine
wine-white|^Alcoholic beverage, wine, table, white$|White wine|Wino białe|białe wino, wino białe, white wine
vodka|^Alcoholic beverage, distilled, all \\(gin, rum, vodka, whiskey\\) 80 proof$|Vodka / spirits|Wódka|wódka, wódki, rum, whisky, gin, vodka, spirits
milk-soy|^Soymilk, original and vanilla, unfortified$|Soy milk|Napój sojowy|mleko sojowe, napój sojowy, soy milk, soya milk
milk-almond|^Beverages, almond milk, unsweetened, shelf stable$|Almond milk|Napój migdałowy|mleko migdałowe, napój migdałowy, almond milk
# ---------- snacks & ready foods ----------
chips|^Snacks, potato chips, plain, salted$|Potato crisps|Chipsy|chipsy, czipsy, chips ziemniaczane, crisps, potato chips
popcorn|^Snacks, popcorn, air-popped$|Popcorn|Popcorn|popcorn, prażona kukurydza
pretzels|^Snacks, pretzels, hard, plain, salted$|Pretzels|Precelki / paluszki|paluszki, precelki, pretzels
nachos|^Snacks, tortilla chips, plain, white corn, salted$|Tortilla chips|Nachosy|nachosy, nachos, tortilla chips
pizza|^Pizza, cheese topping, regular crust, frozen, cooked$|Cheese pizza|Pizza|pizza, pizzy, frozen pizza
mashed|^Potatoes, mashed, home-prepared, whole milk and butter added$|Mashed potatoes|Puree ziemniaczane|puree ziemniaczane, purée, tłuczone ziemniaki, mashed potatoes, mash
croutons|^Croutons, plain$|Croutons|Grzanki|grzanki, grzaneczki, croutons
protein-bar|^Snacks, granola bars, hard, plain$|Granola bar|Baton musli|baton, batonik, baton musli, batonik proteinowy, granola bar, protein bar, cereal bar
# ---------- extras ----------
chicken-gizzard|^Chicken, gizzard, all classes, raw$|Chicken gizzards|Żołądki drobiowe|żołądki, żołądki drobiowe, żołądki z kurczaka, żołądków, gizzards, chicken gizzards
chicken-heart|^Chicken, heart, all classes, raw$|Chicken hearts|Serca drobiowe|serca, serduszka, serca drobiowe, serduszka z kurczaka, chicken hearts
pork-liver|^Pork, fresh, variety meats and by-products, liver, raw$|Pork liver|Wątroba wieprzowa|wątróbka wieprzowa, wątroba wieprzowa, pork liver
beef-tongue|^Beef, variety meats and by-products, tongue, raw$|Beef tongue|Ozór wołowy|ozór, ozorki, ozór wołowy, beef tongue
goose|^Goose, domesticated, meat only, raw$|Goose|Gęś|gęś, gęsina, pierś z gęsi, goose
venison|^Game meat, deer, ground, raw$|Venison|Dziczyzna (jeleń)|dziczyzna, jelenina, sarnina, venison
pork-ham-raw|^Pork, fresh, leg \\(ham\\), rump half, separable lean and fat, raw$|Pork leg (fresh ham)|Szynka wieprzowa surowa|szynka surowa, udziec wieprzowy, mięso z szynki, golonka, pork leg, fresh ham, pork knuckle
pate|^Pate, chicken liver, canned$|Liver pâté|Pasztet|pasztet, pasztetu, pasztet drobiowy, pâté, pate, liver pate
anchovies|^Fish, anchovy, european, canned in oil, drained solids$|Anchovies|Anchois|anchois, sardele, anchovies
scallops|^Mollusks, scallop, \\(bay and sea\\), cooked, steamed$|Scallops|Przegrzebki|przegrzebki, małże świętego jakuba, scallops
egg-quail|^Egg, quail, whole, fresh, raw$|Quail eggs|Jajka przepiórcze|jajka przepiórcze, jaja przepiórcze, quail eggs
oat-bran|^Oat bran, raw$|Oat bran|Otręby owsiane|otręby, otręby owsiane, otrębów, oat bran, bran
wheat-bran|^Wheat bran, crude$|Wheat bran|Otręby pszenne|otręby pszenne, wheat bran
wheat-germ|^Wheat germ, crude$|Wheat germ|Zarodki pszenne|zarodki pszenne, wheat germ
spelt|^Spelt, uncooked$|Spelt grain|Orkisz|orkisz, kasza orkiszowa, spelt
amaranth|^Amaranth grain, uncooked$|Amaranth|Amarantus|amarantus, szarłat, ekspandowany amarantus, amaranth
rice-glutinous|^Rice, white, glutinous, unenriched, uncooked$|Glutinous rice|Ryż kleisty|ryż kleisty, sticky rice, glutinous rice
puffed-rice|^Cereals ready-to-eat, QUAKER, QUAKER Puffed Rice$|Puffed rice|Ryż preparowany|ryż preparowany, ryż dmuchany, puffed rice, rice krispies
pine-nuts|^Nuts, pine nuts, dried$|Pine nuts|Orzeszki piniowe|orzeszki piniowe, orzeszków piniowych, pine nuts
hemp-seeds|^Seeds, hemp seed, hulled$|Hemp seeds|Nasiona konopi|konopie, nasiona konopi, hemp seeds
almond-butter|^Nuts, almond butter, plain, without salt added$|Almond butter|Masło migdałowe|masło migdałowe, almond butter
blackcurrants|^Currants, european black, raw$|Blackcurrants|Czarne porzeczki|porzeczki, porzeczka, czarne porzeczki, porzeczek, blackcurrants, currants
redcurrants|^Currants, red and white, raw$|Redcurrants|Czerwone porzeczki|czerwone porzeczki, białe porzeczki, redcurrants
gooseberries|^Gooseberries, raw$|Gooseberries|Agrest|agrest, agrestu, gooseberries
cranberries|^Cranberries, raw$|Cranberries|Żurawina świeża|świeża żurawina, cranberries
papaya|^Papayas, raw$|Papaya|Papaja|papaja, papaya
persimmon|^Persimmons, japanese, raw$|Persimmon|Kaki (persymona)|kaki, persymona, persimmon
lychee|^Litchis, raw$|Lychee|Liczi|liczi, lychee
passion-fruit|^Passion-fruit, \\(granadilla\\), purple, raw$|Passion fruit|Marakuja|marakuja, passion fruit
figs|^Figs, raw$|Figs (fresh)|Figi świeże|świeże figi, figa, fresh figs
coconut|^Nuts, coconut meat, raw$|Coconut (fresh)|Kokos świeży|miąższ kokosa, fresh coconut
rutabaga|^Rutabagas, raw$|Swede / rutabaga|Brukiew|brukiew, rzepa, swede, rutabaga, turnip
okra|^Okra, raw$|Okra|Okra|okra
chard|^Chard, swiss, raw$|Swiss chard|Boćwina / botwinka|botwinka, botwina, boćwina, szpinak szwajcarski, chard, swiss chard
artichoke|^Artichokes, \\(globe or french\\), frozen, unprepared$|Artichokes|Karczochy|karczoch, karczochy, artichoke, artichokes
spinach-frozen|^Spinach, frozen, chopped or leaf, unprepared|Frozen spinach|Szpinak mrożony|szpinak mrożony, mrożony szpinak, szpinak w brykietach, frozen spinach
chanterelles|^Mushrooms, Chanterelle, raw$|Chanterelles|Kurki|kurki, kurek, chanterelles
oyster-mushrooms|^Mushrooms, oyster, raw$|Oyster mushrooms|Boczniaki|boczniak, boczniaki, boczniaków, oyster mushrooms
shiitake|^Mushrooms, shiitake, raw$|Shiitake|Shiitake|shiitake, grzyby shiitake
portobello|^Mushrooms, portabella, raw$|Portobello|Portobello|portobello, pieczarki portobello, portabella
gummies|^Candies, gumdrops, starch jelly pieces$|Gummy sweets|Żelki|żelki, żelków, gummy bears, gummies, jelly sweets
doughnut|^Doughnuts, yeast-leavened, with jelly filling$|Jam doughnut|Pączek|pączek, pączki, donut, doughnut
pound-cake|^Cake, pound, commercially prepared, butter|Sponge / pound cake|Ciasto (babka)|babka, ciasto, ciasta, biszkopt, sponge cake, pound cake, cake
pancake|^Pancakes, plain, frozen, ready-to-heat|Pancakes|Naleśniki / placki|naleśnik, naleśniki, pancakes, pancake, crepes, racuchy, placuszki
processed-cheese|^Cheese, pasteurized process, American, fortified with vitamin D$|Processed cheese|Ser topiony|ser topiony, serek topiony, plasterki sera topionego, processed cheese, cheese slices, american cheese
goat-cheese|^Cheese, goat, soft type$|Goat cheese|Ser kozi|ser kozi, kozi ser, twarożek kozi, goat cheese, chevre
yogurt-fruit|^Yogurt, fruit, low fat, 9|Fruit yogurt|Jogurt owocowy|jogurt owocowy, jogurt truskawkowy, fruit yogurt
mozzarella-light|^Cheese, mozzarella, part skim milk$|Mozzarella light|Mozzarella light|mozzarella light, part skim mozzarella
energy-drink|^Beverages, Energy drink, RED BULL$|Energy drink|Napój energetyczny|energetyk, red bull, monster, napój energetyczny, energy drink
chocolate-milk-drink|^Milk, chocolate, fluid, commercial, reduced fat|Chocolate milk|Mleko czekoladowe|mleko czekoladowe, kakao z mlekiem, chocolate milk
tomato-soup|^Soup, tomato, canned, prepared with equal volume water, commercial$|Tomato soup|Zupa pomidorowa|zupa pomidorowa, pomidorówka, tomato soup
lasagna|^Lasagna, cheese, frozen, unprepared$|Lasagna (frozen)|Lasagne (gotowa)|lasagne gotowe, gotowa lasagne, frozen lasagna
nuggets|^Chicken, broilers or fryers, breast, meat and skin, cooked, fried, batter$|Fried breaded chicken|Kurczak panierowany|kurczak panierowany, kotlet z kurczaka panierowany, nuggetsy, stripsy, nuggets, breaded chicken, fried chicken
bread-graham|^Bread, multi-grain \\(includes whole-grain\\)$|Multigrain bread|Chleb wieloziarnisty|chleb wieloziarnisty, bułka grahamka, grahamka, multigrain bread
croissant|^Croissants, butter$|Croissant|Rogalik / croissant|croissant, rogalik, rogaliki, croissants
muffin|^Muffins, blueberry, commercially prepared|Muffin|Muffinka|muffinka, muffinki, babeczka, muffin, muffins, cupcake
brownie|^Cookies, brownies, commercially prepared$|Brownie|Brownie|brownie, brownies
cheesecake|^Cake, cheesecake, commercially prepared$|Cheesecake|Sernik|sernik, sernika, cheesecake
apple-pie|^Pie, apple, commercially prepared, enriched flour$|Apple pie|Szarlotka|szarlotka, jabłecznik, szarlotki, apple pie
waffle|^Waffles, plain, frozen, ready-to-heat$|Waffles|Gofry|gofr, gofry, waffle, waffles
ice-cream-choc|^Ice creams, chocolate$|Chocolate ice cream|Lody czekoladowe|lody czekoladowe, chocolate ice cream
halva|^Candies, sesame crunch$|Sesame crunch (sezamki)|Sezamki|sezamki, sezamek, sesame snaps
jerky|^Snacks, beef jerky, chopped and formed$|Beef jerky|Suszona wołowina|suszona wołowina, beef jerky, jerky
ham-canned|^Luncheon meat, pork, canned$|Luncheon meat|Mielonka|mielonka, konserwa, konserwa turystyczna, luncheon meat, spam
chicken-canned|^Chicken, canned, meat only, with broth$|Canned chicken|Kurczak z puszki|kurczak w puszce, canned chicken
salmon-canned|^Fish, salmon, pink, canned, drained solids$|Canned salmon|Łosoś z puszki|łosoś z puszki, canned salmon
`;

// ---------- helpers ----------
function parseCsv(text) {
  // Minimal RFC4180 parser (quoted fields, doubled quotes). Returns array of arrays.
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; i++; continue;
    }
    field += c; i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const readCsv = (dir, name) => {
  const [head, ...rows] = parseCsv(fs.readFileSync(path.join(dir, name), 'utf8'));
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

function ensureData() {
  const find = () => {
    if (!fs.existsSync(CACHE)) return null;
    for (const d of fs.readdirSync(CACHE)) {
      const p = path.join(CACHE, d);
      if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'food.csv'))) return p;
    }
    return null;
  };
  let dir = process.env.USDA_DIR || find();
  if (dir) return dir;
  fs.mkdirSync(CACHE, { recursive: true });
  const zip = path.join(CACHE, 'sr.zip');
  console.log('Downloading USDA SR Legacy (~6 MB)…');
  execSync(`curl -sSL -o "${zip}" "${ZIP_URL}"`, { stdio: 'inherit' });
  execSync(`tar -xf "${zip}" -C "${CACHE}"`, { stdio: 'inherit' });
  dir = find();
  if (!dir) throw new Error('Could not unpack the USDA zip');
  return dir;
}

// Portion descriptions → our unit keys. Returns [key, gramsPerOne] or null.
function portionKey(p) {
  const amount = Number(p.amount) || 1;
  const g = Number(p.gram_weight) / amount;
  if (!(g > 0)) return null;
  const unitName = MEASURE[p.measure_unit_id];
  const text = `${unitName && unitName !== 'undetermined' ? unitName : ''} ${p.modifier || ''} ${p.portion_description || ''}`.toLowerCase().trim();
  if (/whipped|packed|crumbled|melted|drained|pureed|mashed|sifted|unsifted|heaping/.test(text.replace(/\(.*$/, '')) && !/^(tbsp|tsp|tablespoon|teaspoon)/.test(text)) return null;
  const rules = [
    [/^(cup|cups)\b/, 'cup'], [/^(tbsp|tablespoon)/, 'tbsp'], [/^(tsp|teaspoon)/, 'tsp'],
    [/^(clove|cloves)\b/, 'clove'], [/^(slice|slices)\b/, 'slice'], [/^(fl oz)\b/, 'floz'],
    [/^(leaf|leaves)\b/, 'leaf'], [/^(stalk|stalks|spear|spears)\b/, 'stalk'],
    [/^(sprig|sprigs)\b/, 'sprig'], [/^(bunch)\b/, 'bunch'], [/^(head)\b/, 'head'],
    [/^(can)\b/, 'can'], [/^(package|pkg|packet|container)\b/, 'pack'], [/^(cube)\b/, 'cube'],
    [/^(scoop)\b/, 'scoop'], [/^(bar)\b/, 'bar'],
    [/\b(mini|extra small)\b/, null], [/\b(extra large|jumbo)\b/, null],
    [/\bmedium\b/, 'medium'], [/\blarge\b/, 'large'], [/\bsmall\b/, 'small'],
  ];
  for (const [re, key] of rules) if (re.test(text)) return key ? [key, g, text] : null;
  // Anything else that isn't a weight/serving measure is "one piece" (e.g. "croissant", "fruit (2" dia)").
  if (/^(oz|lb|serving|nlea|fl|g|kg|ml|dash|pinch|portion|order|recipe|bowl|batch|quart|pint|gallon|liter|cubic|drink|shot|jigger|individual|pat|package|container|cake|loaf|pie|bottle|box|bag)\b/.test(text)) return null;
  if (/^[a-z]/.test(text)) return ['piece', g, text];
  return null;
}
let MEASURE = {};

function main() {
  const dir = ensureData();
  MEASURE = Object.fromEntries(readCsv(dir, 'measure_unit.csv').map((m) => [m.id, m.name]));
  const foods = readCsv(dir, 'food.csv');
  const nutr = new Map();
  const WANT = { 1008: 'k', 1003: 'p', 1005: 'c', 1004: 'f', 1079: 'fb' };
  for (const r of readCsv(dir, 'food_nutrient.csv')) {
    const key = WANT[r.nutrient_id];
    if (!key) continue;
    if (!nutr.has(r.fdc_id)) nutr.set(r.fdc_id, {});
    nutr.get(r.fdc_id)[key] = Number(r.amount);
  }
  const portions = new Map();
  for (const p of readCsv(dir, 'food_portion.csv')) {
    if (!portions.has(p.fdc_id)) portions.set(p.fdc_id, []);
    portions.get(p.fdc_id).push(p);
  }
  const candidates = foods.filter((f) => !/Alaska Native|American Indian|Navajo|Hopi|Apache|Shoshone|Northern Plains/i.test(f.description));

  const out = [];
  const problems = [];
  const seen = new Set();
  for (const raw of LIST.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, pattern, en, pl, aliases = ''] = line.split('|').map((s) => s.trim());
    if (seen.has(key)) { problems.push(`duplicate key ${key}`); continue; }
    seen.add(key);
    // The descriptions in the CSV have "" for a literal quote only inside the raw file; after parsing it is ".
    const re = new RegExp(pattern.replace(/""/g, '"'), 'i');
    const hits = candidates.filter((f) => re.test(f.description)).sort((a, b) => a.description.length - b.description.length);
    if (!hits.length) { problems.push(`NO MATCH ${key}: ${pattern}`); continue; }
    const f = hits[0];
    const n = nutr.get(f.fdc_id) || {};
    if (n.k == null || n.p == null || n.f == null) { problems.push(`missing nutrients ${key} (${f.description})`); continue; }
    if (n.c == null) n.c = 0;
    const u = {};
    const uText = {};
    for (const p of (portions.get(f.fdc_id) || []).sort((a, b) => Number(a.seq_num) - Number(b.seq_num))) {
      const pk = portionKey(p);
      if (!pk) continue;
      const [k, g, text] = pk;
      if (u[k] == null) { u[k] = Math.round(g * 10) / 10; uText[k] = text; }
    }
    // A "piece" default: medium > piece > large > small.
    if (u.medium != null) u.piece = u.medium;
    if (u.piece == null) u.piece = u.large ?? u.small;
    if (u.piece == null || u.piece > 1000) delete u.piece;
    const r1 = (x) => Math.round(x * 10) / 10;
    const aliasList = aliases.split(',').map((s) => s.trim()).filter(Boolean);
    const item = { id: key, en, pl, a: aliasList, k: Math.round(n.k), p: r1(n.p), c: r1(n.c), f: r1(n.f) };
    if (n.fb) item.fb = r1(n.fb);
    if (Object.keys(u).length) item.u = u;
    item.fdc = Number(f.fdc_id);
    out.push(item);
    if (process.argv.includes('--verbose')) {
      console.log(`${key.padEnd(20)} ${String(item.k).padStart(4)} kcal  P${item.p} C${item.c} F${item.f}  ← ${f.description}${hits.length > 1 ? `  (+${hits.length - 1})` : ''}`);
      if (item.u) console.log(`${''.padEnd(26)}${Object.entries(u).map(([k, v]) => `${k}=${v}g`).join(' ')}`);
    }
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    if (!process.argv.includes('--force')) process.exit(1);
  }
  const json = {
    v: 1,
    source: 'USDA FoodData Central, SR Legacy (2018). Public domain. Values per 100 g; u = grams per unit.',
    foods: out,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const text = JSON.stringify(json).replace(/\},\{"id"/g, '},\n{"id"');
  fs.writeFileSync(OUT, text);
  console.log(`Wrote ${out.length} foods to ${path.relative(process.cwd(), OUT)} (${Math.round(text.length / 1024)} KB)`);
}

main();
