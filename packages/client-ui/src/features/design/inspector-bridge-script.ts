import {
  DESIGN_DATA_IMAGE_PATTERN, DESIGN_STYLE_VALUE_LIMIT, DESIGN_TOKEN_BINDING_PATTERN, DESIGN_TOKEN_NAME_PATTERN,
  DESIGN_TOKEN_PREFIX, DESIGN_TOKEN_RULES, STYLE_RULES,
} from '@ormicode/protocol';

export const INSPECTOR_LAYER_EXPORT_LIMIT = 96 * 1024;
export const INSPECTOR_TOKEN_CSS_LIMIT = 6144;

// CSS copied from the live element and its descendants. The file never receives the frame's style sheets.
const exportProperties = [
  'display', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
  'position', 'top', 'right', 'bottom', 'left', 'z-index', 'transform', 'transform-origin', 'rotate', 'scale', 'translate',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'align-items', 'align-content',
  'justify-self', 'justify-items', 'justify-content', 'grid-template-rows', 'grid-template-columns', 'grid-auto-flow',
  'grid-row', 'grid-column', 'gap', 'order', 'padding', 'margin', 'overflow', 'white-space', 'word-break',
  'opacity', 'visibility', 'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow',
  'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'text-align', 'letter-spacing', 'text-decoration',
  'text-transform', 'direction', 'color', 'object-fit', 'object-position', 'vertical-align', 'fill', 'stroke', 'stroke-width',
];
const exportedRootExclusions = ['position', 'left', 'right', 'top', 'bottom', 'margin', 'z-index', 'translate'];

export const INSPECTOR_BRIDGE_SCRIPT = String.raw`
const rules=${JSON.stringify(STYLE_RULES)};
const styles=Object.keys(rules);
const styleLimit=${DESIGN_STYLE_VALUE_LIMIT};
const tokenBinding=new RegExp(${JSON.stringify(DESIGN_TOKEN_BINDING_PATTERN)});
const tokenDeclaration=new RegExp(${JSON.stringify('^' + DESIGN_TOKEN_PREFIX + '(' + DESIGN_TOKEN_NAME_PATTERN + '):(.+)$')});
const tokenRules=${JSON.stringify(Object.values(DESIGN_TOKEN_RULES))};
const dataImage=new RegExp(${JSON.stringify(DESIGN_DATA_IMAGE_PATTERN)});
const layerExportLimit=${INSPECTOR_LAYER_EXPORT_LIMIT};
const exportProperties=${JSON.stringify(exportProperties)};
const rootExclusions=new Set(${JSON.stringify(exportedRootExclusions)});
const cssName=property=>property.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
function validValue(property,value){
  if(!Object.hasOwn(rules,property)||typeof value!=='string'||/[\r\n]/.test(value))return false;
  const {choices,pattern,ignoreCase,token,limit}=rules[property];
  if(value.length>(limit??styleLimit))return false;
  if(value==='')return true;
  const binding=tokenBinding.exec(value);
  if(binding ? !(token&&binding[1].length<=40) : !matchesInspectorRule({choices,pattern,ignoreCase},value))return false;
  return !globalThis.CSS?.supports||CSS.supports(cssName(property),value);
}
function matchesInspectorRule({choices,pattern,ignoreCase},value){
  return Boolean(choices?.includes(value)||(pattern&&new RegExp(pattern,ignoreCase?'i':'').test(value)));
}
function inspectorSnapshot(el){
  const computed=getComputedStyle(el);
  const stylesSnapshot={},computedSnapshot={};
  for(const property of styles){
    const inlineValue=el.style.getPropertyValue(cssName(property));
    const computedValue=computed.getPropertyValue(cssName(property));
    const limit=rules[property].limit??styleLimit;
    if(inlineValue.length<=limit)stylesSnapshot[property]=inlineValue;
    if(computedValue.length<=limit)computedSnapshot[property]=computedValue;
  }
  const rect=el.getBoundingClientRect();
  return {
    styles:stylesSnapshot,computed:computedSnapshot,
    geometry:{
      width:Math.min(100000,el.offsetWidth??rect.width),height:Math.min(100000,el.offsetHeight??rect.height),
      parentLayout:getComputedStyle(el.parentElement).display.slice(0,40),
      parentDirection:getComputedStyle(el.parentElement).flexDirection.slice(0,20)
    }
  };
}
function applyInspectorStyles(el,patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))return;
  const entries=Object.entries(patch);
  if(!entries.length||entries.length>8||!entries.every(([property,value])=>validValue(property,value)))return;
  const before=el.getAttribute('style');
  for(const [property,value] of entries)el.style.setProperty(cssName(property),value);
  if(!el.style.length)el.removeAttribute('style');
  select(el);
  if(before!==el.getAttribute('style'))serialize();
}
function alignInspectorLayer(el,axis,alignment){
  if(!['x','y'].includes(axis)||!['start','center','end'].includes(alignment)||!el.parentElement)return;
  const parent=el.parentElement, bounds=parent.getBoundingClientRect(), rect=el.getBoundingClientRect();
  const horizontal=axis==='x';
  const property=horizontal?'left':'top';
  const start=horizontal?bounds.left+parent.clientLeft:bounds.top+parent.clientTop;
  const available=(horizontal?parent.clientWidth-rect.width:parent.clientHeight-rect.height);
  const desired=start+available*({start:0,center:0.5,end:1}[alignment]);
  const computed=getComputedStyle(el), position=computed.position||'static';
  const margin=parseFloat(horizontal?computed.marginLeft:computed.marginTop)||0;
  const defaultOffset=position==='absolute'||position==='fixed'?((horizontal?el.offsetLeft:el.offsetTop)??0)-margin:0;
  const current=parseFloat(computed[property]);
  const change=desired-(horizontal?rect.left:rect.top);
  const offset=Math.max(-99999,Math.min(99999,Math.round(((Number.isFinite(current)?current:defaultOffset)+change)*100)/100));
  applyInspectorStyles(el,{...(position==='static'?{position:'relative'}:{}),[property]:offset+'px'});
}
function applyInspectorTokenStyles(css){
  if(typeof css!=='string'||css.length>${INSPECTOR_TOKEN_CSS_LIMIT})return false;
  if(css){
    if(!css.startsWith(':root{')||!css.endsWith('}')||/[\r\n]/.test(css))return false;
    const declarations=css.slice(6,-1).split(';');
    if(declarations.length>32||!declarations.every(declaration=>{
      const match=tokenDeclaration.exec(declaration);
      return match&&match[1].length<=40&&match[2].length<=styleLimit&&tokenRules.some(rule=>matchesInspectorRule(rule,match[2]));
    }))return false;
  }
  let node=document.head.querySelector('#design-tokens');
  if(!node){node=document.createElement('style');node.id='design-tokens';document.head.append(node)}
  node.textContent=css;
  return true;
}
function exportInspectorLayer(el){
  const clone=el.cloneNode(true);
  const originals=[el,...el.querySelectorAll('*')];
  if(originals.length>600){send({type:'layerExport',html:''});return}
  const copies=[clone,...clone.querySelectorAll('*')];
  let styleSize=0;
  for(let i=0;i<originals.length;i++){
    const computed=getComputedStyle(originals[i]), copy=copies[i];
    copy.removeAttribute('data-ormi-node');
    copy.removeAttribute('style');
    for(const property of exportProperties){
      if(i===0&&rootExclusions.has(property))continue;
      const value=computed.getPropertyValue(property);
      if(!value||/[;{}<>\\\r\n]/.test(value.replace(/^url\("data:image\/[a-z]+;base64,/i,''))
        ||value.length>(property==='background-image'?8192:160))continue;
      if(/url\s*\(|(?:image-set|image|src|var|attr)\s*\(/i.test(value)&&!(property==='background-image'&&dataImage.test(value)))continue;
      if(value!=='none'||property==='display')copy.style.setProperty(property,value);
    }
    if(i===0)copy.style.setProperty('position','relative');
    styleSize+=(copy.getAttribute('style')||'').length;
    if(styleSize>layerExportLimit){send({type:'layerExport',html:''});return}
  }
  const html=clone.outerHTML;
  send({type:'layerExport',html:html.length<=layerExportLimit?html:''});
}
`;
