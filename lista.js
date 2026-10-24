/* Lista della spesa del Ricettario, letta da Jarvis.
   Queste funzioni sono copiate dal Ricettario (index.html) così la lista che legge Jarvis
   è identica a quella che vedi nell'app: stesse somme, stessa dispensa, stesse voci spuntate. */
(function(){
var dispensa = {};
function ico(){ return ''; }
function normalize(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
var NUM_RE = /^(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(.*)$/;
function fmtNum(n){
  var r = Math.round(n*2)/2; // nearest 0.5
  if(Math.abs(r - Math.round(r)) < 0.01) return String(Math.round(r));
  return String(r).replace('.', ',');
}
var UNIT_WORDS = ['g','gr','grammi','kg','chilo','chili','ml','cl','l','litro','litri',
  'cucchiai','cucchiaino','cucchiaini','cucchiaio','tazza','tazze','pizzico','pizzichi','fetta','fette',
  'confezione','confezioni','spicchio','spicchi','rametto','rametti','foglia','foglie','bicchiere','costa'];
function bareIngredientName(rest){
  var t = (rest || '').trim();
  // frazioni unicode iniziali (½ bicchiere di vino, ½ cipolla...) trattate come quantità
  t = t.replace(/^[½¼¾⅓⅔]\s*/, '');
  // articoli indeterminativi iniziali (un pizzico di sale, una confezione di...)
  t = t.replace(/^(un|una|uno)\s+/i, '');
  for(var i=0;i<UNIT_WORDS.length;i++){
    var re = new RegExp('^'+UNIT_WORDS[i]+"\\b\\s*(di\\s+|d['\u2019]\\s*)?", 'i');
    if(re.test(t)){ return t.replace(re, '').trim(); }
  }
  return t;
}
var INGREDIENT_SYNONYMS = {
  'carote':'carota',
  'ceci cotti':'ceci', 'ceci gia cotti':'ceci',
  'fagioli cotti':'fagioli',
  'formaggio a scelta':'formaggio', 'formaggio grattugiato':'formaggio',
  'gamberi freschi':'gamberi',
  'mozzarelle':'mozzarella',
  'pane raffermo':'pane', 'pane raffermo ammollato nel latte':'pane',
  'pangrattato per rotolare':'pangrattato', 'pangrattato q.b.':'pangrattato',
  'parmigiano (facoltativo)':'parmigiano', 'parmigiano grattugiato':'parmigiano',
  'patate (facoltative)':'patate',
  'pecorino romano grattugiato fine':'pecorino romano grattugiato',
  'peperoncino (facoltativo)':'peperoncino', 'peperoncino a piacere':'peperoncino',
  'peperoncino fresco o secco':'peperoncino', 'peperoncino q.b.':'peperoncino',
  'pomodori':'pomodoro',
  'ricotta o formaggio cremoso':'ricotta', 'ricotta o formaggio spalmabile':'ricotta',
  'sale q.b.':'sale', 'pizzico di sale':'sale',
  'sale e pepe q.b.':'sale e pepe',
  "spicchi d'aglio":'aglio', "spicchi di aglio, aperti a meta":'aglio', "spicchio d'aglio":'aglio',
  'tonno sott\'olio':'tonno', 'tonno sott\'olio sgocciolato':'tonno', 'tranci di tonno fresco':'tonno',
  'tuorlo':'uova', "tuorlo d'uovo (per spennellare)":'uova', 'uovo':'uova',
  'verdure a scelta':'verdure', 'verdure di stagione':'verdure', 'verdure grigliate':'verdure', 'verdure miste':'verdure',
  'zucchine medie':'zucchine',
  'tranci di salmone fresco':'salmone', 'salmone fresco':'salmone',
  'orate pulite':'orata',
  'filetti di branzino fresco':'branzino',
  'fettine sottili di pollo':'pollo', 'petto di pollo':'pollo', 'macinato di pollo':'pollo',
  'sovracosce di pollo (speziate o al naturale, a piacere)':'sovracosce di pollo'
};
function canonicalIngredientName(rest){
  var bare = bareIngredientName(rest);
  var key = normalize(bare);
  return INGREDIENT_SYNONYMS[key] || bare;
}
function isPantryStaple(rest){
  return !!dispensa[normalize(canonicalIngredientName(rest))] || !!dispensa[normalize(bareIngredientName(rest))] || !!dispensa[normalize(rest)];
}
var CATEGORY_LIST = [
  {name:'Carne e pesce', icon:ico('drumstick'), words:['pollo','tacchino','gamber','merluzzo','salmone','tonno','branzin','orat','polpo','prosciutto','manzo','maiale','vitello','pesce','cozz','calamar','sogliol','carne','bistecc','straccetti','girello','magatello','pancetta','guanciale','sovracosc']},
  {name:'Latticini e uova', icon:ico('egg'), words:['uov','mozzarell','parmigian','pecorino','ricotta','formagg','latte','burro','yogurt','grana','stracchino','mascarpone','scamorza','provola','panna','besciamella']},
  {name:'Dispensa', icon:ico('jar'), words:['pasta','riso','farina','farro','cous cous','ceci','fagiol','lenticchi','pane','pangrattato','passata','brodo','olio','sale','pepe','pesto','piadine','zucchero','lievito','aceto','tahina','cumino','paprika','alloro','vino','olive','capperi','acciug','cioccolat','cacao','savoiardi','amaretti','amido','tortillas','caffe','sfoglie','spaghetti','penne','rigatoni','tagliatelle','bucatini','maccheroni','pelati','concentrato']},
  {name:'Verdura e frutta', icon:ico('leaf'), words:['carot','cipoll','melanzan','mais','peperon','pomodor','zucchin','verdur','fung','champignon','patat','basilic','insalata','limone','aglio','rosmarino','prezzemolo','spinaci','broccol','finocch','cavolfior','zucca','fagiolin','aranc','sedano','rucola','salvia','banan','=mele','=mela','cetriol']}
];
var FRESH_OVERRIDES = ['peperon','fagiolin'];
function categoryFor(text){
  var n = normalize(text);
  var verdura = CATEGORY_LIST[CATEGORY_LIST.length-1];
  for(var f=0;f<FRESH_OVERRIDES.length;f++){
    if(n.indexOf(FRESH_OVERRIDES[f]) !== -1) return verdura;
  }
  for(var i=0;i<CATEGORY_LIST.length;i++){
    var cat = CATEGORY_LIST[i];
    for(var j=0;j<cat.words.length;j++){
      var w = cat.words[j];
      if(w.charAt(0) === '='){
        if(new RegExp('\\b'+w.slice(1)+'\\b').test(n)) return cat;
      } else if(n.indexOf(w) !== -1) return cat;
    }
  }
  return {name:'Altro', icon:ico('cart'), words:[]};
}
function safeKey(s){ return normalize(s).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
var UNIT_CANON = {
  g:'g', gr:'g', grammi:'g', kg:'kg', chilo:'kg', chili:'kg',
  ml:'ml', cl:'cl', l:'l', litro:'l', litri:'l',
  cucchiai:'cucchiaio', cucchiaino:'cucchiaino', cucchiaini:'cucchiaino', cucchiaio:'cucchiaio',
  tazza:'tazza', tazze:'tazza', pizzico:'pizzico', pizzichi:'pizzico',
  fetta:'fetta', fette:'fetta', confezione:'confezione', confezioni:'confezione',
  spicchio:'spicchio', spicchi:'spicchio', rametto:'rametto', rametti:'rametto',
  foglia:'foglia', foglie:'foglia', bicchiere:'bicchiere', costa:'costa'
};
var FRAC_VALUES = {'\u00bd':0.5, '\u00bc':0.25, '\u00be':0.75, '\u2153':1/3, '\u2154':2/3};
function parseQtyPrefix(text){
  var t = (text||'').trim();
  var fm = t.match(/^([\u00bd\u00bc\u00be\u2153\u2154])\s*/);
  if(fm) return {qty: FRAC_VALUES[fm[1]], rest: t.slice(fm[0].length).trim()};
  var m = NUM_RE.exec(t);
  if(m) return {qty: parseFloat(m[1].replace(',', '.')), rest: m[2].trim()};
  return {qty: null, rest: t};
}
function extractUnitType(rest){
  var t = (rest||'').trim().replace(/^(un|una|uno)\s+/i, '');
  for(var u in UNIT_CANON){
    if(new RegExp('^'+u+'\\b', 'i').test(t)) return UNIT_CANON[u];
  }
  return null;
}
function buildShoppingList(lines){
  var groups = {};
  lines.forEach(function(item){
    var txt = item.text, recipeTitle = item.recipeTitle;
    var p = parseQtyPrefix(txt);
    var rest = p.rest || txt.trim();
    if(isPantryStaple(rest)) return;
    var unit = extractUnitType(rest);
    var canonName = canonicalIngredientName(rest);
    var k = (unit||'count') + '|' + normalize(canonName);
    if(!groups[k]) groups[k] = {rest:rest, total:0, hasNum:false, count:0, bestQty:-1, recipes:[]};
    var g = groups[k];
    g.count++;
    if(p.qty !== null){
      g.total += p.qty; g.hasNum = true;
      if(p.qty > g.bestQty){ g.bestQty = p.qty; g.rest = rest; }
    }
    if(recipeTitle && g.recipes.indexOf(recipeTitle) === -1) g.recipes.push(recipeTitle);
  });
  var out = Object.keys(groups).map(function(k){
    var g = groups[k];
    var label = g.hasNum ? (fmtNum(g.total)+' '+g.rest) : (g.count>1 ? g.rest+' (x'+g.count+')' : g.rest);
    var cat = categoryFor(g.rest);
    return {key:safeKey(g.rest), label:label, cat:cat.name, icon:cat.icon, recipes:g.recipes};
  });
  out.sort(function(a,b){
    var ci = CATEGORY_LIST.map(function(c){return c.name;}).concat(['Altro']);
    var d = ci.indexOf(a.cat) - ci.indexOf(b.cat);
    if(d !== 0) return d;
    return a.label.localeCompare(b.label);
  });
  return out;
}
window.RicLista = {
  build: function(lines, disp){ dispensa = disp || {}; return buildShoppingList(lines); },
  normalize: normalize, safeKey: safeKey
};
})();
