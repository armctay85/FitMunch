'use strict';
/**
 * Food lexicon (copied from the #127 rebuild) for the #127a Coach reply check.
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
  // ── #127a r3: Australian brands, products and dishes (fail closed: every likely allergen) ──
  [[D, G], 'milo|sustagen|coco pops|golden gaytime|gaytime|vanilla slice'],
  [[D, S, G], 'up and go|upandgo|musashi|mars protein bar|clif|clif bar|cornetto|paddle pop|freddo|bounty|yakult'],
  [[D], 'chobani|yakult|paddle pop|freddo|bounty'],
  [[E], 'golden gaytime|gaytime|vanilla slice|arancini|spanakopita|pierogi|char kway teow'],
  [[N], 'clif|clif bar|cornetto|mochi|pb|pb and j|pbj'],
  [[S], 'lentil and tempeh bolognese|tempeh bolognese|tofu bolognese'],
  [[], 'lentil bolognese|vegan bolognese|veggie bolognese|vegetable bolognese'],
  [[D, S, N, G], 'protein bar|energy bar|snack bar|breakfast bar'],
  [[S], 'mochi|freddo|bounty|kfc|hungry jacks|hungry jack|char kway teow|banh xeo'],
  [[G, M, D, E, S], 'kfc|hungry jacks|hungry jack'],
  [[SE], 'hungry jacks|hungry jack'],
  [[G, D, E, M], 'arancini|spanakopita|pierogi'],
  [[G, SH, F, M], 'char kway teow|banh xeo'],
  // ── #127a r5: FSANZ shellfish terms, snails, and more AU brands (EQA #135 r4 M1, L1) ──
  [[SH], 'crustacea|crustacean|crustaceans|mollusca|bivalve|bivalves|mollusc|molluscs|mollusk|mollusks|cephalopod|cephalopods|gastropod|gastropods|snail|snails|escargot|whelk|whelks|periwinkle|sea snail'],
  [[D], 'big m|yoplait'],
  [[G, D], 'shapes'],
  [[G, D, E, S, M], 'dominos|domino'],
  // ── #127a r6: more AU brands (EQA #135 r5 L1). Fail closed: every likely allergen. Chobani is dairy only. ──
  [[G, D, E, N, S, SE], 'arnotts|arnott'],
  [[D, G, S], 'caramello|caramello koala'],
  [[G, D, E, S, SE, F, M], 'maccas|macca|mcdonalds|mcdonald|subway'],
  [[G, D, E, S, SE, M], 'oporto'],
  // The category word itself ("have some dairy"). "dairy free" is a longer safe phrase and still wins.
  [[D], 'dairy'],
  // Generic powders and bars fail closed. A named plant protein stays clear of dairy and soy.
  // "dairy out" / "no dairy" are the avoidance phrasing, so they do not flag the word dairy.
  [[], 'pea protein|pea protein powder|rice protein|rice protein powder|hemp protein|pea protein shake|rice protein shake|no dairy|without dairy|dairy out|avoid dairy|skip dairy'],
  [[D], 'protein powder|protein shake'],
  [[S], 'plant protein|plant protein shake|plant protein powder|soy protein shake'],
  [[N], 'musashi|mars protein bar|granola'],
];

const SAFE_SRC = `
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

/** NFKD, no accents or invisible characters, look-alikes to Latin, lower case, letters and digits only. */
function normalise(text) {
  return String(text == null ? '' : text)
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
const tokensOf = (text) => { const n = normalise(text); return n ? n.split(' ').map(singular) : []; };

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
// Same phrases as food-lexicon.js so both scanners agree. "smoothie" is a carrier below so it does not
// paint dairy back onto a plant-milk smoothie.
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
// #127a: a dish phrase also carries the flags of its own words ("teriyaki chicken" is gluten, "chicken satay"
// is nuts), except carrier words that name a form, not the food ("peanut butter" is not dairy).
const CARRIERS = new Set(['butter', 'milk', 'cream', 'yoghurt', 'yogurt', 'cheese', 'oil', 'flour', 'paste', 'sauce', 'meal', 'spread', 'bar', 'stick', 'roll', 'bun', 'pie', 'cake', 'bolognese', 'smoothie']);
for (const list of PHRASES.values()) {
  for (const p of list) {
    if (!p.flags.length || p.toks.length < 2) continue;
    for (const t of p.toks) {
      if (CARRIERS.has(t)) continue;
      const one = (PHRASES.get(t) || []).find((q) => q.toks.length === 1);
      if (one) for (const f of one.flags) if (!p.flags.includes(f)) p.flags.push(f);
    }
  }
}
for (const list of PHRASES.values()) list.sort((a, b) => b.toks.length - a.toks.length);

const SAFE = new Set(tokensOf(SAFE_SRC));

/** Add more recognised words (template and food database names). */
function addSafe(text) { for (const t of tokensOf(text)) SAFE.add(t); }

/**
 * Scan text. Returns { flags: Set, unknown: [tokens] }. Safe phrases consume their words; numbers and
 * quantities ("150g", "2x", "1/2") count as recognised.
 */
function scan(text) {
  const flags = new Set(); const unknown = []; const rest = [];
  // Phrases never run across punctuation: "rice, milk powder" is rice and milk powder, not rice milk.
  for (const part of String(text == null ? '' : text).split(/[,;:.!?()[\]{}/\\|\n\r\t+*"<>=~^]+/)) { const kept = []; scanPart(tokensOf(part), flags, unknown, kept); rest.push(kept.join(' ')); }
  // rest: the text without the known-safe phrases ("butter beans"), for matchers that don't know them.
  return { flags, unknown, rest: rest.join(', ') };
}
function scanPart(toks, flags, unknown, kept) {
  for (let i = 0; i < toks.length;) {
    const list = PHRASES.get(toks[i]);
    let matched = null;
    if (list) for (const p of list) { if (p.toks.every((t, j) => toks[i + j] === t)) { matched = p; break; } }
    if (matched) { for (const f of matched.flags) flags.add(f); if (matched.flags.length) kept.push(...matched.toks); i += matched.toks.length; continue; }
    const t = toks[i];
    kept.push(t);
    if (!/^\d+[a-z]{0,4}$/.test(t) && !/^[a-z]?\d/.test(t) && !SAFE.has(t)) unknown.push(t);
    i += 1;
  }
}

/** A known dish with exactly these flags (FitMunch's own checked templates). Replaces any flags the words would add. */
function addKnown(text, flags) {
  const toks = tokensOf(text);
  if (!toks.length) return;
  const list = PHRASES.get(toks[0]) || [];
  const key = toks.join(' ');
  const hit = list.find((p) => p.key === key);
  if (hit) hit.flags = [...flags]; else list.push({ key, toks, flags: [...flags] });
  list.sort((a, b) => b.toks.length - a.toks.length);
  PHRASES.set(toks[0], list);
}

module.exports = { addKnown, normalise, singular, tokensOf, scan, addSafe, DENY_SRC, SAFE, DENY_WORDS };
