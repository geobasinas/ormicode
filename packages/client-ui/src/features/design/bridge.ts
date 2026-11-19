import { INSPECTOR_BRIDGE_SCRIPT } from './inspector-bridge-script.ts';

export const BRIDGE_SCRIPT = `(()=>{
const root=document.getElementById('root');let channel='';let hostOrigin='';let selected=null;let serial=0;
${INSPECTOR_BRIDGE_SCRIPT}
const send=m=>parent.postMessage({...m,channel},'*');const find=id=>root.querySelector('[data-ormi-node="'+CSS.escape(id)+'"]');
const pathPattern=/^\\d{1,5}(?:\\.\\d{1,5}){0,23}$/;
function elementPath(el){const parts=[];while(el!==root&&parts.length<24){const parent=el.parentElement;if(!parent)return '';parts.unshift(Array.prototype.indexOf.call(parent.children,el));el=parent}const path=parts.join('.');return el===root&&pathPattern.test(path)?path:''}
function clearSelection(){selected=null;if(outlineNode)outlineNode.style.display='none'}
function select(el){
  if(!el||el===root)return;
  selected=el;const id=el.dataset.ormiNode||'n'+(++serial);el.dataset.ormiNode=id;
  const leaf=el.children.length===0;
  const text=leaf?(el.textContent||'').slice(0,500):'';
  send({type:'selected',id,path:elementPath(el),tag:el.tagName.toLowerCase(),leaf,text,...inspectorSnapshot(el)});outline(el);
}
let outlineNode;function outline(el){if(!outlineNode){outlineNode=document.createElement('div');outlineNode.style.cssText='position:fixed;pointer-events:none;border:2px solid #888;box-shadow:0 0 0 1px #fff,0 0 0 2px #555;box-sizing:border-box;z-index:2147483647';document.body.append(outlineNode)}outlineNode.style.display='block';const r=el.getBoundingClientRect();outlineNode.style.left=r.left+'px';outlineNode.style.top=r.top+'px';outlineNode.style.width=r.width+'px';outlineNode.style.height=r.height+'px'}
function serialize(){const clone=root.cloneNode(true);clone.querySelectorAll('[data-ormi-node]').forEach(el=>el.removeAttribute('data-ormi-node'));send({type:'serialized',html:clone.innerHTML})}
window.addEventListener('message',event=>{
  if(event.source!==parent||!event.data||typeof event.data!=='object')return;
  const m=event.data;
  const shapes={init:['html','styles','tokenStyles'],render:['html','styles','tokenStyles'],setTokenStyles:['tokenStyles'],
    selectPath:['path'],clearSelection:[],editText:['id','text'],editStyle:['id','property','value'],editStyles:['id','patch'],
    alignElement:['id','axis','alignment'],exportLayer:['id'],addElement:['kind'],serialize:[]};
  if(typeof m.type!=='string'||!Object.hasOwn(shapes,m.type)||Object.keys(m).some(k=>!['type','channel',...shapes[m.type]].includes(k))
    ||('id'in m&&(typeof m.id!=='string'||!/^n[0-9]{1,10}$/.test(m.id))))return;
  if(!channel){if(m.type!=='init'||typeof m.channel!=='string'||m.channel.length<20||m.channel.length>100)return;channel=m.channel;hostOrigin=event.origin}
  else if(event.origin!==hostOrigin||m.channel!==channel)return;
  if(m.type==='init'||m.type==='render'){
    if(typeof m.html!=='string'||m.html.length>65536||typeof m.styles!=='string'||m.styles.length>17408
      ||!applyInspectorTokenStyles(m.tokenStyles??''))return;
    root.innerHTML=m.html;
    let style=document.head.querySelector('#design-styles');
    if(!style){style=document.createElement('style');style.id='design-styles';document.head.append(style)}
    style.textContent=m.styles;clearSelection();return;
  }
  if(m.type==='setTokenStyles'){if(applyInspectorTokenStyles(m.tokenStyles)&&selected)select(selected);return}
  if(m.type==='clearSelection'){clearSelection();return}
  if(m.type==='selectPath'){
    if(typeof m.path!=='string'||!pathPattern.test(m.path))return;
    const el=m.path.split('.').reduce((node,index)=>node?.children[Number(index)],root);
    if(el){el.scrollIntoView?.({block:'nearest',inline:'nearest'});select(el)}return;
  }
  if(m.type==='editText'&&typeof m.id==='string'&&typeof m.text==='string'&&m.text.length<=500){
    const el=find(m.id);if(el&&el.children.length===0){el.textContent=m.text;select(el);serialize()}return;
  }
  const target=typeof m.id==='string'&&selected?.dataset.ormiNode===m.id?selected:null;
  if(m.type==='editStyle'){if(target&&typeof m.property==='string')applyInspectorStyles(target,{[m.property]:m.value});return}
  if(m.type==='editStyles'){if(target)applyInspectorStyles(target,m.patch);return}
  if(m.type==='alignElement'){if(target)alignInspectorLayer(target,m.axis,m.alignment);return}
  if(m.type==='exportLayer'){if(target)exportInspectorLayer(target);return}
  if(m.type==='addElement'&&['text','button','container'].includes(m.kind)){
    const el=document.createElement(m.kind==='text'?'p':m.kind==='button'?'button':'div');
    el.textContent=m.kind==='button'?'Button':m.kind==='text'?'Text':'Container';
    if(m.kind==='button')el.type='button';root.append(el);select(el);serialize();return;
  }
  if(m.type==='serialize')serialize();
});root.addEventListener('click',event=>{const el=event.target instanceof Element?event.target.closest('*'):null;if(el&&root.contains(el)){event.preventDefault();event.stopPropagation();select(el)}});window.addEventListener('scroll',()=>{if(selected)outline(selected)},true);})();`;
export const BRIDGE_HASH = 'JIdnuUUHf5nvgvBXHTHRci0xWOlHs4Pw3s3f6SXZgI4=';
export const BRIDGE_SRC_DOC = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${BRIDGE_HASH}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"><style>html,body,#root{height:100%;margin:0}*,*::before,*::after{box-sizing:border-box}#root>svg:only-child{display:block}</style></head><body><div id="root"></div><script>${BRIDGE_SCRIPT}</script></body></html>`;
