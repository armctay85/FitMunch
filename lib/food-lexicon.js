'use strict';
/**
 * Food lexicon for the allergen check on AI-written meals.
 *
 * DENY: phrases (dishes, ingredients, products) and the allergen or diet flags they carry. Matching is on
 * normalised tokens (NFKD, accents, zero-width characters and soft hyphens removed, look-alike Cyrillic and
 * Greek letters mapped to Latin, lower case, punctuation as spaces), longest phrase first, with simple
 * singular forms, so "Plain-Flour", "PLAIN FLOUR", "plain flours" and "plain\u200Bflour" all match. Every
 * multi-word phrase also matches written as one word ("peanutbutter", "almondmilk", "eggwhite").
 * Phrases with no flags ("coconut milk", "butter beans", "cream of tartar") are known safe and stop a
 * shorter phrase inside them from matching ("butter", "milk").
 *
 * SAFE: words recognised as food, cooking or recipe words. For a user with filters, a meal string with a
 * word that is neither in SAFE nor in a DENY phrase is unrecognised, and the meal fails closed.
 */
const G = 'gluten'; const D = 'dairy'; const N = 'nuts'; const E = 'eggs'; const S = 'soy'; const SE = 'sesame';
const SH = 'shellfish'; const F = 'fish'; const M = 'meat';

const DENY_SRC = [
  // ── known safe phrases that contain an allergen word ──
  [[], 'coconut milk|coconut cream|coconut yoghurt|coconut yogurt|coconut water|coconut flour|coconut oil|coconut sugar|coconut aminos|desiccated coconut|shredded coconut|cocoa butter|shea butter|apple butter|butter beans|butter bean|butter lettuce|butternut pumpkin|butternut squash|butternut|cream of tartar|rice milk|rice noodles|rice noodle|rice vermicelli|rice paper|rice flour|brown rice flour|corn flour|cornflour|maize flour|potato flour|tapioca flour|chickpea flour|besan flour|besan|buckwheat flour|buckwheat|buckwheat groats|sorghum flour|quinoa flour|arrowroot flour|lentil pasta|chickpea pasta|rice pasta|konjac noodles|zucchini noodles|glass noodles|kelp noodles|sweet potato noodles|mung bean noodles|nutmeg|ground nutmeg|eggplant|eggplants|water chestnut|water chestnuts|tiger nut|coconut|nutritional yeast|doughnut peach|fish free|egg free|nut free|dairy free|gluten free|wheat free|soy free|sesame free|shellfish free|meat free|lactose free|peanut free|sugar free|fat free|free range|cashew free|oyster mushroom|oyster mushrooms|king oyster mushroom|crab apple|crabapple|jackfruit|breadfruit|monkfruit|monk fruit|honeydew melon|rockmelon|cream soda|ice cubes|sweet corn|creamed corn|corn chips|tortilla chips corn|rice cakes|rice cake|corn thins|cos lettuce|green beans|vegan cheese|rice porridge|quinoa porridge|millet porridge|buckwheat porridge|amaranth porridge|chia porridge|congee|vegetable stock|vegetable broth|veggie stock|mushroom stock|vegetable stock cube|chilli flakes|chili flakes|salt flakes|sea salt flakes|coconut flakes|kidney bean|kidney beans|hearts of palm|hemp hearts|artichoke hearts|artichoke heart|lentil patties|bean patties|veggie patties'],
  // ── gluten ──
  [[G], 'wheat|flour|plain flour|self raising flour|self rising flour|wholemeal flour|bread flour|wheat flour|spelt|spelt flour|kamut|einkorn|emmer|durum|semolina|bulgur|bulghur|burghul|freekeh|farro|couscous|pearl couscous|seitan|gluten|vital wheat gluten|wheat germ|wheatgerm|wheat bran|bran|bran flakes|barley|pearl barley|barley malt|malt|malted|malt vinegar|malt extract|maltodextrin wheat|rye|rye bread|pumpernickel|triticale|oat|oats|rolled oats|quick oats|steel cut oats|oat bran|oatmeal|oat milk|porridge|granola|muesli|bircher|weetbix|weet bix|cereal|cornflakes|corn flakes|bread|breads|breadcrumb|breadcrumbs|panko|crouton|croutons|toast|sourdough|white bread|wholemeal bread|multigrain bread|bread roll|dinner roll|roll|bun|buns|bap|bagel|croissant|brioche|focaccia|ciabatta|baguette|pita|pitta|pita bread|lavash|naan|roti|chapati|paratha|puri|tortilla|tortillas|flour tortilla|wrap|wraps|burrito|quesadilla|taco shell|crumpet|english muffin|muffin|scone|pancake|pikelet|waffle|crepe|pastry|puff pastry|filo|filo pastry|phyllo|shortcrust|pie|pies|tart|quiche|cake|cakes|cupcake|brownie|biscuit|biscuits|cookie|cookies|cracker|crackers|pretzel|pretzels|wafer|doughnut|donut|dough|pizza|pizza base|calzone|stromboli|pasta|spaghetti|penne|fettuccine|fettucine|fettuccini|linguine|tagliatelle|pappardelle|fusilli|farfalle|rigatoni|macaroni|orzo|risoni|lasagne|lasagna|lasagne sheets|ravioli|tortellini|cannelloni|conchiglie|orecchiette|gnocchi|noodle|noodles|egg noodles|wheat noodles|hokkien noodles|udon|ramen|soba|soba noodles|somen|lo mein|chow mein|dumpling|dumplings|wonton|wontons|gyoza|dim sum|spring roll|spring rolls|samosa|pasty|sausage roll|vegemite|marmite|promite|soy sauce|shoyu|teriyaki|teriyaki sauce|hoisin|hoisin sauce|oyster sauce|kecap manis|worcestershire|worcestershire sauce|gravy|stock cube|beer|ale|lager|stout|crumbed|breaded|battered|batter|schnitzel|katsu|tonkatsu|tempura|crumble|stuffing|sandwich|toastie|sub|burger|hamburger|cheeseburger|big mac|whopper|quarter pounder|hot dog|meat pie|pad see ew|pad thai noodles|anzac biscuit|anzac biscuits|tim tam|tim tams|kitkat|kit kat|twix|mars bar|lamington|banana bread|tiramisu|cannoli|baklava|churros|nuggets|chicken nuggets|fish and chips|fish fingers|okonomiyaki|bao|banh mi|laksa|mie goreng|mee goreng|nasi goreng|caesar salad|tabouli|tabbouleh|fattoush|panzanella|bruschetta|crostini|garlic bread|yorkshire pudding|seitan'],
  // ── dairy ──
  [[D], 'milk|whole milk|skim milk|full cream milk|lite milk|milk powder|powdered milk|evaporated milk|condensed milk|sweetened condensed milk|buttermilk|butter|butters|salted butter|unsalted butter|ghee|cream|thickened cream|sour cream|creme fraiche|double cream|single cream|whipped cream|whipping cream|clotted cream|ice cream|gelato|frozen yoghurt|cheese|cheeses|cream cheese|cottage cheese|ricotta|cheddar|parmesan|parmigiano|pecorino|grana padano|mozzarella|bocconcini|burrata|feta|halloumi|haloumi|paneer|brie|camembert|gouda|edam|emmental|gruyere|swiss cheese|blue cheese|gorgonzola|roquefort|stilton|mascarpone|labneh|quark|skyr|kefir|yoghurt|yogurt|greek yoghurt|greek yogurt|natural yoghurt|whey|whey protein|casein|lactose|curd|custard|bechamel|alfredo|carbonara|queso|tzatziki|raita|lassi|milkshake|smoothie|latte|cappuccino|flat white|mocha|hot chocolate|milk chocolate|white chocolate|chocolate|caramel|toffee|fudge|panna cotta|cheesecake|mac and cheese|macaroni cheese|parmigiana|parma|pizza|big mac|cheeseburger|whopper|quarter pounder|snickers|mars bar|kitkat|kit kat|twix|tim tam|tim tams|tiramisu|cannoli|pavlova|ghee rice|paneer tikka|butter chicken|korma|saag paneer|pesto|scone|scones|pancake|pancakes|waffle|croissant|brioche|creamy|cheesy|white sauce|garlic bread|caesar salad|quiche|lamington|banana bread|nuggets|yorkshire pudding'],
  // ── nuts and peanuts ──
  [[N], 'nut|nuts|mixed nuts|tree nut|tree nuts|peanut|peanuts|groundnut|groundnuts|monkey nuts|peanut butter|peanut oil|peanut sauce|almond|almonds|almond milk|almond meal|almond flour|almond butter|flaked almonds|slivered almonds|marzipan|frangipane|amaretti|cashew|cashews|cashew cream|cashew butter|cashew milk|walnut|walnuts|walnut oil|pecan|pecans|hazelnut|hazelnuts|hazelnut spread|hazelnut milk|filbert|nutella|gianduja|praline|pistachio|pistachios|macadamia|macadamias|macadamia oil|macadamia milk|brazil nut|brazil nuts|pine nut|pine nuts|pignoli|chestnut|chestnuts|nut butter|nut milk|nut oil|nut bar|nut mix|trail mix|scroggin|satay|satay sauce|pesto|romesco|dukkah|duqqa|baklava|nougat|gado gado|massaman|massaman curry|korma|pad thai|kung pao|praline|rocky road|snickers|picnic bar|muesli bar|nut roast|bakewell|florentine|biscotti|panforte|amaretto|frangelico|almond croissant|peanut brittle|brittle|turron|halva|lamington'],
  // ── eggs ──
  [[E], 'egg|eggs|whole egg|egg white|egg whites|egg yolk|egg yolks|eggwhite|eggwhites|eggwhite omelette|boiled egg|boiled eggs|poached egg|fried egg|scrambled egg|scrambled eggs|scramble|omelette|omelet|frittata|quiche|shakshuka|tamagoyaki|eggs benedict|benedict|mayo|mayonnaise|kewpie|aioli|hollandaise|bearnaise|meringue|meringues|pavlova|custard|creme brulee|creme caramel|flan|souffle|egg noodles|egg pasta|fresh pasta|fried rice|nasi goreng|pad see ew|pad thai|egg fried rice|egg roll|carbonara|caesar|caesar salad|caesar dressing|tartare sauce|tartar sauce|brioche|challah|pancake|pancakes|waffle|waffles|crepe|crepes|cake|cakes|muffin|muffins|brownie|cookie|cookies|pastry|french toast|zabaglione|eggnog|marshmallow|nougat|tempura|batter|battered|lemon curd|curd|tiramisu|lamington|banana bread|okonomiyaki|big mac|whopper|nicoise|egg salad|kedgeree|bibimbap|ramen|scotch egg|aioli dressing|ranch dressing|thousand island'],
  // ── soy ──
  [[S], 'soy|soya|soybean|soybeans|soy bean|soy beans|soya bean|soy sauce|shoyu|tamari|light soy|dark soy|soy milk|soya milk|soy yoghurt|soy protein|soy protein isolate|soy lecithin|soya lecithin|lecithin|soybean oil|soy oil|soy flour|tofu|silken tofu|firm tofu|tofu puffs|tempeh|edamame|miso|miso paste|white miso|natto|tvp|textured vegetable protein|vegan mince|plant mince|veggie mince|veggie burger|vegan sausage|teriyaki|teriyaki sauce|hoisin|hoisin sauce|kecap manis|black bean sauce|doenjang|gochujang|ponzu|yuba|okara|bean curd|mapo tofu|agedashi|pad see ew|nasi goreng|mie goreng|mee goreng|tempura|snickers|big mac|whopper|kitkat|kit kat|mars bar|twix|chocolate|tim tam|tim tams|furikake|bulgogi|dim sum|gyoza|dumpling|dumplings|wonton|katsu sauce|tonkatsu sauce|laksa|ramen|udon soup|stir fry sauce|satay|satay sauce|gado gado|kung pao|chow mein|lo mein|sushi|poke|poke bowl|teriyaki chicken|bibimbap'],
  // ── sesame ──
  [[SE], 'sesame|sesame seed|sesame seeds|sesame oil|toasted sesame|black sesame|white sesame|tahini|tahina|hummus|houmous|hommus|halva|halvah|halwa|baba ganoush|baba ghanoush|zaatar|za atar|zatar|dukkah|duqqa|gomasio|gomashio|furikake|benne|benne seed|benne seeds|gingelly|til|simsim|sesame bagel|sesame bun|big mac|whopper|cheeseburger|burger bun|hamburger|sushi|poke|poke bowl|bibimbap|bulgogi|sesame chicken|lavash|pretzel|bagel|falafel'],
  // ── shellfish (also seafood) ──
  [[SH, F], 'shellfish|seafood|prawn|prawns|king prawn|king prawns|tiger prawns|shrimp|shrimps|shrimp paste|belacan|blachan|crab|crabs|crabmeat|crab meat|blue swimmer crab|mud crab|soft shell crab|lobster|lobsters|rock lobster|crayfish|crawfish|yabby|yabbies|marron|redclaw|bug|bugs|moreton bay bug|moreton bay bugs|balmain bug|balmain bugs|bay bug|bay bugs|scampi|langoustine|mussel|mussels|oyster|oysters|scallop|scallops|clam|clams|pipi|pipis|vongole|cockle|cockles|abalone|periwinkle|whelk|sea urchin|uni|squid|calamari|octopus|baby octopus|cuttlefish|krill|surimi|seafood stick|seafood sticks|crab stick|crab sticks|paella|bisque|chowder|marinara mix|seafood marinara|tom yum|tom yum goong|laksa|nasi goreng|oyster sauce|xo sauce|prawn cracker|prawn crackers|har gow|siu mai|dim sum|pad thai|bouillabaisse|cioppino|gumbo|jambalaya|ceviche|tempura prawns|green curry paste|red curry paste|curry paste|sambal|fish and chips'],
  // ── fish ──
  [[F], 'fish|fishes|fillet of fish|white fish|salmon|smoked salmon|atlantic salmon|tuna|tinned tuna|canned tuna|tuna steak|barramundi|basa|whiting|flathead|kingfish|yellowtail|john dory|dory|snapper|bream|cod|hake|haddock|pollock|pollack|hoki|ling|blue grenadier|grenadier|trout|ocean trout|rainbow trout|mackerel|sardine|sardines|pilchard|pilchards|anchovy|anchovies|herring|kipper|kippers|sole|flounder|halibut|tilapia|perch|murray cod|coral trout|mahi mahi|swordfish|marlin|shark|flake|gummy shark|mullet|garfish|leatherjacket|redfish|nannygai|trevally|tailor|mulloway|jewfish|dhufish|catfish|carp|eel|unagi|roe|caviar|fish roe|salmon roe|ikura|tarama|taramasalata|fish sauce|nam pla|nuoc mam|anchovy paste|bonito|bonito flakes|katsuobushi|dashi|worcestershire|worcestershire sauce|caesar|caesar salad|caesar dressing|nicoise|kedgeree|sushi|sashimi|nigiri|poke|poke bowl|fish cake|fish cakes|fishcake|fish fingers|fish and chips|fish curry|fish pie|tom yum|laksa|pad thai|nasi goreng|kimchi|green curry|red curry|massaman|massaman curry|pho|som tam|larb|seafood|surimi|omega 3 fish oil|fish oil|gelatine fish|isinglass|puttanesca|tapenade'],
  // ── meat and poultry ──
  [[M], 'meat|meats|chicken|chicken breast|chicken thigh|chicken thighs|chicken wing|chicken wings|drumstick|drumsticks|rotisserie chicken|roast chicken|chicken stock|chicken broth|chicken salt|chicken nuggets|nuggets|poultry|turkey|turkey breast|duck|duck breast|goose|quail|pheasant|emu|beef|steak|rump|sirloin|scotch fillet|eye fillet|porterhouse|t bone|brisket|beef stock|beef broth|veal|mince|beef mince|pork mince|lamb mince|chicken mince|turkey mince|lamb|lamb cutlets|lamb chops|lamb shank|mutton|goat|kid|pork|pork belly|pork chop|pork loin|pork ribs|ribs|spare ribs|pulled pork|bacon|ham|prosciutto|pancetta|speck|salami|pepperoni|chorizo|sausage|sausages|snag|snags|frankfurt|frankfurter|hot dog|kabana|cabanossi|mortadella|bresaola|jamon|pastrami|corned beef|silverside|biltong|jerky|beef jerky|meatball|meatballs|meatloaf|burger patty|patty|patties|hamburger|cheeseburger|big mac|whopper|quarter pounder|bolognese|ragu|kebab|doner|gyros|souvlaki|shawarma|kangaroo|venison|rabbit|hare|bison|buffalo|liver|chicken liver|pate|offal|kidney|kidneys|heart|tripe|oxtail|tongue|bone broth|bone marrow|stock|broth|gravy|lard|dripping|tallow|suet|gelatine|gelatin|chicken fat|duck fat|schnitzel|parma|parmigiana|katsu|tonkatsu|carbonara|meat pie|sausage roll|pie|laksa|nasi goreng|pad thai|bulgogi|char siu|san choy bow|larb|pho|ramen|wonton|wontons|dumpling|dumplings|gyoza|dim sum|siu mai|spring roll|samosa|pasty|caesar salad|bibimbap|butter chicken|chicken tikka|tikka masala|vindaloo|rogan josh|korma|satay chicken|chicken satay|marshmallow|lasagne|lasagna|cassoulet|moussaka|shepherds pie|cottage pie|chilli con carne|chili con carne|con carne|taco|tacos|fajitas|burrito|nachos'],
];

DENY_SRC.push(
  [[N], 'cacahuete|cacahuetes|cacahuate|arachide|arachides|erdnuss|erdnusse|mani|amande|amandes|noix|noisette|nocciola|mandorla|muesli|granola|gado gado|nut cluster|nut clusters'],
  [[D], 'anzac biscuit|anzac biscuits|caesar wrap|risotto|moussaka|cheesecake|choc|choc chip|parmy|parmi|chicken parmy|chicken parmi|chai latte|dirty chai|frappe|frappuccino|thickshake|choc milk|iced coffee|iced chocolate|butter chicken|mac n cheese'],
  [[E], 'gado gado|katsu|chicken katsu|mee goreng|mie goreng|moussaka|cheesecake|calamari rings|surimi|snickers|pad thai|spag carbonara|eggy bread|egg and bacon roll|bacon and egg roll|brekkie roll|egg mcmuffin|mcmuffin'],
  [[G], 'moussaka|cheesecake|calamari rings|surimi|spag bol|spag|parmy|parmi|blt|kfc|nandos wrap|choc chip|muesli|granola|risoni|mcmuffin|egg mcmuffin|brekkie roll|egg and bacon roll|bacon and egg roll|eggy bread|wrap|chips and gravy|dim sim|dim sims|potato cake'],
  [[M], 'spag bol|parmy|parmi|blt|kfc|nandos|peri peri chicken|chicken parmy|tandoori chicken|pulled pork|pulled beef|pulled chicken|snag roll|sausage sizzle|egg and bacon roll|bacon and egg roll|mcmuffin|egg mcmuffin|dim sim|dim sims'],
  [[F], 'barra|barra fillet|fish tacos|tuna bake|salmon poke|tuna mornay'],
  [[SH, F], 'seafood marinara|marinara mix|prawn cocktail|calamari rings|surimi'],
  // Gastropods are molluscs too (FSANZ "molluscs").
  [[SH, F], 'crustacea|crustacean|crustaceans|mollusc|molluscs|mollusk|mollusks|mollusca|bivalve|bivalves|cephalopod|cephalopods|gastropod|gastropods|snail|snails|escargot|escargots|whelk|whelks|periwinkle|periwinkles|sea snail|cockle|cockles|vongole|pipi|pippies|balmain bug|balmain bugs|moreton bay bug|moreton bay bugs|bay bug|bay bugs|yabby|yabbies|marron|redclaw|crawfish|langoustine|scampi|cuttlefish|baby octopus|razor clam|abalone|sea urchin'],
  // Gluten-free flours: the word "flour" in them is not wheat.
  [[N], 'almond flour|almond meal|hazelnut flour|hazelnut meal'],
  [[], 'gluten free flour|gf flour|rice flour|brown rice flour|buckwheat flour|chickpea flour|besan flour|tapioca flour|sorghum flour|potato flour|cassava flour|arrowroot flour|corn flour gluten free'],
  // Korean fermented pastes are usually made with wheat or barley.
  [[G, S], 'gochujang|doenjang|ssamjang|gochujang sauce|gochujang paste'],
  // Branded foods: brand names are not ingredients, so each carries what it contains.
  [[D, S], 'up and go|up go|upandgo|up n go|upngo|sanitarium up and go|musashi|musashi protein|musashi shake|musashi bar'],
  [[D], 'chobani|yoplait|big m|dare iced coffee|ski yoghurt|vaalia|danone|activia|jalna|farmers union|yakult|oak milk|norco|a2 milk|bulla|connoisseur ice cream|magnum ice cream|paddle pop|golden gaytime|cornetto'],
  [[G], 'coco pops|rice bubbles|nutri grain|froot loops|sultana bran|uncle tobys|cheerios|crunchy nut|frosties|milo cereal|malt vinegar'],
  [[D], 'bega|bega cheese|bega stringers|bega tasty|rokeby|rokeby farms|rokeby protein|kraft singles|kraft cheese|philadelphia|philly cream cheese|cadbury|cadbury dairy milk|freddo|freddo frog|freddo frogs|caramello|caramello koala|caramello koalas'],
  [[D, S], 'sustagen|sustagen sport|sustagen hospital|ensure|milo|nesquik|freddo|cadbury|caramello koala'],
  [[G, D], 'shapes|arnotts shapes|arnott shapes|twisties|cheese twisties|arnott|arnotts|scotch finger|scotch fingers|arnotts scotch finger|arnott scotch finger|monte carlo|iced vovo|mint slice|tiny teddy|tiny teddies|jatz|salada|sao|saos|vita weat|cruskits|tim tams'],
  [[G], 'milo|milo cereal|allen|allens|allen lolly|allens lollies|allen lollies|allens snakes|snakes alive|killer python|killer pythons|red frog|red frogs|chicos|minties|fantales|jaffas'],
  [[N], 'bega peanut butter|kraft peanut butter|sanitarium peanut butter'],
  // r6: chat brands QA found leaking. Smith's and Grain Waves flavours vary, so they carry the worst case.
  [[G, D], 'cheezels|cheezel|le snak|le snaks|smiths|smiths chips|smiths crinkle cut|grain waves|grainwaves'],
  [[G, D, S], 'maltesers|malteser'],
  [[G, D, N, S], 'kinder bueno|kinder buenos|kinder|kinder surprise|kinder chocolate'],
  // r7: Peters Drumstick is an ice cream cone (not meat); Connoisseur is ice cream; Indomie noodles are wheat and soy.
  [[G, D, N], 'peters drumstick|peters drumsticks|drumstick ice cream|drumstick cone'],
  [[D], 'peters|peters ice cream|connoisseur|connoisseur gourmet'],
  [[G, S], 'indomie|indomie mi goreng|indomie mie goreng|indomie noodles'],
  // 'PB' is peanut butter in a typed meal name (#135 knows it too).
  [[N], 'pb|pb toast|pb and j|pbj|pb sandwich|pb2|pb2 powder|pbfit|pb fit|powdered peanut butter|peanut powder|peanut butter powder'],
  // Lactose-free milk is still cow's milk.
  [[D], 'pauls|pauls zymil|zymil|zymil milk|lactose free milk|lactose free|pauls milk'],
  [[N], 'mars bar|mars bars|m and ms|picnic bar|cherry ripe|bounty bar|toblerone|ferrero rocher|nutella'],
);

const SAFE_SRC = `
zooper dooper zooper doopers icy pole icy poles
veg veggie veggies vego vegetarian vegan plant based meatless chip chips hot chips fries wedges avo smashed avo spag bol
coke cola zero diet soft drink soda lemonade energy drink sports drink electrolyte chai latte flat white long black
start started complex great refreshing everything together ready omega perfect workout pre post favourite favorite keep
squeeze squeezed goddess pulled sunrise sunset rainbow marinara peri tandoori satisfying filling hearty wholesome delicious
nutritious balanced fuel fuelled boost boosting quick quickly easy weeknight weekday weekend lunchbox family friendly kid kids
crowd pleaser leftover leftovers batch batched freezer friendly portable on the go grab go packed packable simple bright fresh
vibrant colourful colorful zingy punchy herby garlicky lemony citrusy nutty earthy sweetish golden crispy sticky saucy loaded
stuffed baked roasted charred blistered caramelised caramelized braised slow cooked pressure cooker instant pot sheet pan one
pot one pan bowl bowls buddha poke grain power protein packed high fibre low carb keto paleo whole30 macro friendly
assemble assembled arrange arranged divide divided portion portioned spoon spooned pour poured spread spreading layer
fold folded flip flipped turn turned shake shaken store stored refrigerate fridge freeze reheat reheated enjoy eat eaten
serve alongside side salad greens leafy crunch crunchy texture flavour flavor flavours taste tasty yum hit spot treat
daily week weekly monday tuesday wednesday thursday friday saturday sunday today tomorrow tonight morning afternoon
lunchtime dinnertime supper brunch brekkie arvo snack snacking mid midday
complex carbs carbohydrate slow release lean protein healthy fats good fats fibre rich iron calcium vitamin vitamins mineral
minerals antioxidant antioxidants nutrient nutrients energy satiety recovery muscle muscles gains cut cutting bulk bulking
maintain maintenance training gym run running session sessions
`;
const SAFE_SRC_MAIN = `
a an and or of the with without in on to for from into onto over under through plus then until per each
every any some little lots extra optional side serve served serving servings portion portions total
your you it its this that these those is are be as at by up off out all half quarter third whole
piece pieces slice slices sliced dice diced chop chopped mince minced grate grated shred shredded
crush crushed mash mashed puree pureed peel peeled halved quartered cubed cube cubes strip strips
ring rings wedge wedges floret florets sprig sprigs leaf leaves stalk stalks stick sticks clove cloves
head bunch handful handfuls pinch dash splash drizzle sprinkle sprinkled scattered scatter garnish
garnished topping toppings topped top layer layered dressing dressed drizzled tossed toss mix mixed
mixing stir stirred stirring add added adding combine combined place placed put season seasoned
seasoning taste tasted cook cooked cooking uncooked raw fresh frozen thawed tinned canned drained
rinsed dried dry soaked sprouted ripe ripened large small medium big mini baby jumbo thick thin fine
finely roughly coarsely lightly gently well evenly quickly slowly about approx approximately around
roast roasted roasting bake baked baking grill grilled grilling barbecue barbecued bbq chargrill
chargrilled charred char steam steamed steaming boil boiled boiling simmer simmered poach poached
saute sauteed pan panfried fried fry frying stirfry stirfried airfried airfry air fryer oven
microwave microwaved blend blended blender whisk whisked heat heated warm warmed hot cold chilled
chill cool cooled room temperature rest rested cover covered uncovered lid preheat preheated
tray traybake sheet dish dishes bowl bowls plate plates cup cups jar jars glass mug pot pan skillet
wok saucepan tin can cans packet pack bag bottle container lunchbox
g gram grams kg kilo kilos ml millilitre millilitres l litre litres tbsp tablespoon tablespoons tsp
teaspoon teaspoons oz lb x pcs pc approx kcal cal cals calories calorie protein proteins carbs carb
carbohydrate carbohydrates fat fats fibre fiber sugar sugars sodium salt macro macros min mins minute
minutes hour hours hr hrs second seconds overnight day days night morning evening breakfast lunch
dinner snack snacks meal meals prep prepped mealprep recipe method step steps notes note tip tips
ingredient ingredients instructions serves yield makes make made making cookbook
low reduced light lite lean extra virgin unsweetened unsalted sweetened salted plain natural organic
wholegrain wholemeal brown white red green yellow orange purple black golden pink style
mild spicy spiced hot sweet sour savoury savory smoky smoked tangy zesty crispy crunchy crisp soft
tender juicy creamy fluffy chunky smooth hearty quick easy simple healthy high rich classic homemade
home made gourmet rustic traditional australian aussie asian thai indian mexican italian greek
japanese korean chinese vietnamese middle eastern mediterranean moroccan lebanese spanish french
american cajun tex mex
bowl salad soup stew curry chilli chili casserole bake skewers skewer kebabs tray platter plate
power buddha nourish grain grains energy bites bite bar slice balls ball cup pot jar parfait
pudding porridge hash fritters fritter patties burrito bowl tacos taco wrap
free range freerange grassfed grass fed organic cage
rice basmati jasmine arborio wild brown risotto pilaf quinoa millet amaranth sorghum teff polenta
cornmeal grits corn maize popcorn tapioca sago arrowroot cassava yuca taro konjac vermicelli
potato potatoes sweet kumara yam yams pumpkin squash zucchini courgette eggplant aubergine capsicum
pepper peppers chilli chillies jalapeno jalapenos tomato tomatoes cherry roma truss sundried
onion onions shallot shallots spring scallion scallions leek leeks garlic ginger galangal lemongrass
turmeric carrot carrots celery celeriac beetroot beet beets radish radishes turnip parsnip swede
broccoli broccolini cauliflower cabbage wombok bok choy pak choi choy sum kale spinach silverbeet
chard rocket arugula lettuce iceberg cos romaine mesclun watercress endive radicchio fennel
asparagus artichoke artichokes okra snow peas sugar snap peas pea peas beans bean green
mushroom mushrooms button portobello shiitake enoki swiss brown cup flat cucumber cucumbers
lebanese avocado avocados olive olives kalamata caper capers gherkin gherkins pickle pickles
pickled sauerkraut alfalfa sprouts bean sprouts microgreens herbs herb basil coriander cilantro
parsley mint dill chives thyme rosemary oregano sage tarragon bay marjoram lemon lime limes lemons
zest juice juiced
apple apples pear pears banana bananas orange oranges mandarin mandarins grapefruit berries berry
strawberry strawberries blueberry blueberries raspberry raspberries blackberry blackberries cherries
grape grapes kiwi kiwifruit mango mangoes pineapple papaya pawpaw passionfruit melon watermelon
rockmelon cantaloupe honeydew peach peaches nectarine nectarines plum plums apricot apricots fig figs
date dates medjool prune prunes raisin raisins sultana sultanas currants cranberries cranberry goji
pomegranate lychee lychees guava persimmon dragonfruit acai coconut desiccated rhubarb quince feijoa
lentil lentils chickpea chickpeas kidney cannellini borlotti black pinto navy lima broad fava mung
adzuki split dal dhal legume legumes pulses falafel bean beans refried
chia flax flaxseed linseed linseeds pumpkin pepitas sunflower seed seeds hemp hearts psyllium husk
oil oils olive canola sunflower rice bran avocado vegetable grapeseed cooking spray
vinegar balsamic apple cider red wine white wine rice vinegar
honey maple syrup agave golden molasses treacle jam marmalade sugar brown caster icing raw stevia
salt sea flakes pepper ground cracked cumin coriander paprika smoked chilli flakes cayenne cinnamon
nutmeg cloves cardamom allspice star anise fennel seeds mustard seeds fenugreek garam masala curry
powder five spice sumac saffron vanilla extract bean essence cocoa cacao nibs carob baking soda
bicarbonate yeast nutritional cornstarch gelatin agar
mustard dijon wholegrain ketchup tomato sauce passata paste salsa guacamole chutney relish sriracha
harissa chimichurri gremolata tabasco hot sauce sweet chilli sauce bbq barbecue sauce stock vegetable
broth water sparkling mineral springwater tea coffee espresso black herbal green matcha juice
smoothie shake ice cubes cordial kombucha
protein powder plant pea rice isolate supplement electrolyte
tofu tempeh edamame
chicken beef fish salmon tuna egg eggs milk cheese yoghurt
`;

const CONFUSABLE = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y',
  'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ԛ': 'q', 'ԝ': 'w', 'ɡ': 'g', 'ı': 'i', 'ł': 'l',
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ð': 'd', 'þ': 'th',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'g');
const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

// Food emoji read as the food they show (the app's own diet tags use 🦐 and 🥜).
const EMOJI = {
  '🥜': ' peanut ', '🌰': ' chestnut ', '🦐': ' prawn ', '🦞': ' lobster ', '🦀': ' crab ', '🦑': ' squid ', '🐙': ' octopus ', '🦪': ' oyster ',
  '🐟': ' fish ', '🐠': ' fish ', '🐡': ' fish ', '🍣': ' sushi ', '🍤': ' tempura prawn ', '🥚': ' egg ', '🍳': ' fried egg ', '🧀': ' cheese ',
  '🥛': ' milk ', '🧈': ' butter ', '🍦': ' ice cream ', '🍨': ' ice cream ', '🍧': ' ice cream ', '🍰': ' cake ', '🎂': ' cake ', '🧁': ' cupcake ',
  '🥧': ' pie ', '🍪': ' cookie ', '🍩': ' doughnut ', '🍫': ' chocolate ', '🍞': ' bread ', '🥖': ' baguette ', '🥐': ' croissant ', '🥯': ' bagel ',
  '🥨': ' pretzel ', '🥞': ' pancake ', '🧇': ' waffle ', '🍕': ' pizza ', '🍔': ' burger ', '🌭': ' hot dog ', '🥪': ' sandwich ', '🌮': ' taco ',
  '🌯': ' burrito ', '🍝': ' pasta ', '🍜': ' ramen ', '🥟': ' dumpling ', '🥠': ' fortune cookie ', '🥩': ' steak ', '🍖': ' meat ', '🍗': ' chicken ',
  '🥓': ' bacon ', '🫘': ' beans ', '🍙': ' rice ball ', '🍚': ' rice ', '🍘': ' rice cracker ', '🥮': ' mooncake ', '🧆': ' falafel ', '🥙': ' pita ',
};
const EMOJI_RE = new RegExp(Object.keys(EMOJI).join('|'), 'gu');
/** Characters that are neither letters, digits, spaces nor punctuation once normalised (emoji, symbols). */
const SYMBOL_RE = /[\p{Extended_Pictographic}\p{So}\p{Co}]/u;

/** NFKD, no accents or invisible characters, look-alikes to Latin, lower case, letters and digits only. */
function normalise(text) {
  return String(text == null ? '' : text).replace(EMOJI_RE, (e) => EMOJI[e])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(INVISIBLE_RE, '')
    .toLowerCase()
    .replace(CONFUSABLE_RE, (c) => CONFUSABLE[c])
    .replace(/&/g, ' and ')
    .replace(/['’‘`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Simple singular form, applied the same way to text and lexicon. */
function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
// "40gpeanuts", "2xprawns", "1egg": a quantity joined to a word is the quantity and the word.
const QTY_JOINED = /^(\d+(?:\.\d+)?)(kg|mg|g|ml|l|x|tbsp|tsp|cups?|oz|lb|pcs?)?([a-z]{2,})$/;
const QTY = /^\d+(?:\.\d+)?(?:kg|mg|g|ml|l|x|tbsp|tsp|cups?|oz|lb|cm|kcal|cal|pcs?|st|nd|rd|th)?$/;
function splitQty(t) { const m = QTY_JOINED.exec(t); return m && !QTY.test(t) ? [m[1] + (m[2] || ''), m[3]] : [t]; }
const tokensOf = (text) => { const n = normalise(text); return n ? n.split(' ').flatMap(splitQty).map(singular) : []; };

// phrase index: first token -> [{ toks, flags }], longest first
const PHRASES = new Map();
const DENY_WORDS = new Set();
function addPhrase(toks, flags) {
  if (!toks.length) return;
  const list = PHRASES.get(toks[0]) || [];
  const key = toks.join(' ');
  const hit = list.find((p) => p.key === key);
  if (hit) { for (const f of flags) if (!hit.flags.includes(f)) hit.flags.push(f); } else list.push({ key, toks, flags: [...flags] });
  PHRASES.set(toks[0], list);
  for (const t of toks) DENY_WORDS.add(t);
}
// Plant-milk smoothies and butternut risotto are not cow's milk. Longer phrases beat "smoothie", "risotto",
// "mayonnaise", "bread" and "bug", so the whole dish is safe and the leftover word is not flagged.
DENY_SRC.push(
  [[S], 'soy milk smoothie|soya milk smoothie'],
  [[G], 'oat milk smoothie'],
  [[N], 'almond milk smoothie|cashew milk smoothie'],
  [[], 'rice milk smoothie|coconut milk smoothie|butternut risotto|butternut squash risotto|egg free mayonnaise|gluten free bread|dead bug|dead bugs'],
);

for (const [flags, src] of DENY_SRC) {
  for (const p of src.split('|')) {
    const toks = tokensOf(p);
    addPhrase(toks, flags);
    if (toks.length > 1) addPhrase([singular(normalise(p).replace(/ /g, ''))], flags); // "peanutbutter"
  }
}
// One-word allergen entries, for near-miss spellings. Foreign names that fail closed get flags here too.
const SINGLE = [];
for (const list of PHRASES.values()) for (const p of list) if (p.toks.length === 1 && p.flags.length) SINGLE.push([p.toks[0], p.flags]);
for (const list of PHRASES.values()) list.sort((a, b) => b.toks.length - a.toks.length);

const SAFE = new Set([...tokensOf(SAFE_SRC), ...tokensOf(SAFE_SRC_MAIN)]);

/** Add more recognised words (template and food database names). */
function addSafe(text) { for (const t of tokensOf(text)) SAFE.add(t); }

/**
 * Scan text. Returns { flags: Set, unknown: [tokens] }. Safe phrases consume their words; numbers and
 * quantities ("150g", "2x", "1/2") count as recognised.
 */
function scan(text) {
  const flags = new Set(); const unknown = []; const rest = [];
  // Phrases never run across punctuation: "rice, milk powder" is rice and milk powder, not rice milk.
  for (const part of String(text == null ? '' : text).split(/[,;:.!?()[\]{}/\\|\n\r\t+*"<>=~^]+/)) { const kept = []; if (SYMBOL_RE.test(part.replace(EMOJI_RE, ' '))) unknown.push('unrecognised symbol'); scanPart(tokensOf(part), flags, unknown, kept); rest.push(kept.join(' ')); }
  // rest: the text without the known-safe phrases ("butter beans"), for matchers that don't know them.
  return { flags, unknown, rest: rest.join(', ') };
}
function scanPart(toks, flags, unknown, kept) {
  for (let i = 0; i < toks.length;) {
    const list = PHRASES.get(toks[i]);
    let matched = null;
    if (list) for (const p of list) { if (p.toks.every((t, j) => toks[i + j] === t)) { matched = p; break; } }
    if (matched) { for (const f of matched.flags) flags.add(f); if (matched.flags.length) kept.push(...(matched.flags.includes('gluten') ? matched.toks : matched.toks.filter((x) => x !== 'flour' && x !== 'meal'))); i += matched.toks.length; continue; }
    const t = toks[i];
    kept.push(t);
    if (!QTY.test(t) && !SAFE.has(t)) {
      unknown.push(t);
      const near = nearAllergen(t); // "penut" is unknown and also reads as peanut
      if (near) for (const f of near.flags) flags.add(f);
    }
    i += 1;
  }
}

/** Near-miss spellings of allergen words (\"penut\", \"sesmae\"): edit distance 1, or 2 for long words. */
const NEAR_CACHE = new Map();
function nearAllergen(token) {
  if (token.length < 4 || SAFE.has(token)) return null;
  if (NEAR_CACHE.has(token)) return NEAR_CACHE.get(token);
  const hit = nearAllergenScan(token);
  if (NEAR_CACHE.size >= 20000) NEAR_CACHE.clear();
  NEAR_CACHE.set(token, hit);
  return hit;
}
// Letter counts: one edit (insert, delete, change, swap) moves at most one letter in and one out, so two
// words within distance d differ by at most d letters each way. A cheap filter before the edit distance.
const countsOf = (w) => { const c = new Int16Array(27); for (let i = 0; i < w.length; i += 1) { const k = w.charCodeAt(i) - 97; c[k >= 0 && k < 26 ? k : 26] += 1; } return c; };
const SINGLE_COUNTS = new Map();
function letterGap(a, b) {
  let out = 0; let into = 0;
  for (let k = 0; k < 27; k += 1) { const d = a[k] - b[k]; if (d > 0) out += d; else into -= d; if (out > 2 || into > 2) return 3; }
  return Math.max(out, into);
}
function nearAllergenScan(token) {
  const tc = countsOf(token);
  for (const [w, flags] of SINGLE) {
    if (Math.abs(w.length - token.length) > 2 || w.length < 4) continue;
    let wc = SINGLE_COUNTS.get(w);
    if (!wc) { wc = countsOf(w); SINGLE_COUNTS.set(w, wc); }
    if (letterGap(tc, wc) > (w.length >= 7 ? 2 : 1)) continue;
    const d = editDistance(token, w, 2);
    if (d <= (w.length >= 7 ? 2 : 1)) return { word: w, flags };
  }
  return null;
}
function editDistance(a, b, max) {
  // Damerau-Levenshtein (adjacent swaps count as one), stopping once every path is over max.
  let pp = null; let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    pp = prev; prev = cur;
  }
  return prev[b.length];
}

module.exports = { nearAllergen, SYMBOL_RE, normalise, singular, tokensOf, scan, addSafe, DENY_SRC, SAFE };
