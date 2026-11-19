import { DESIGN_PROTOTYPE_ACTION_PATTERN, DESIGN_PROTOTYPE_ATTRIBUTE } from '@ormicode/protocol';

export const PROTOTYPE_BRIDGE_SCRIPT = `
const prototypeAttribute=${JSON.stringify(DESIGN_PROTOTYPE_ATTRIBUTE)};
const prototypePattern=new RegExp(${JSON.stringify(DESIGN_PROTOTYPE_ACTION_PATTERN)});
const hotspotSelector='['+prototypeAttribute+']';
let playing=false,playback=false;
function prototypeAction(el){
  const value=el.getAttribute(prototypeAttribute);
  return typeof value==='string'&&prototypePattern.test(value)?value:null;
}
function preparePlayback(){
  root.setAttribute('data-prototype-player','');
  for(const el of root.querySelectorAll(hotspotSelector)){
    if(!prototypeAction(el)||el.matches('button'))continue;
    el.setAttribute('tabindex','0');
    if(!el.hasAttribute('role'))el.setAttribute('role','button');
  }
}
function configurePlayback(m){
  playing=m.enabled===true;
  root.toggleAttribute('data-prototype-hints',playing&&m.hints===true);
}
function triggerPrototype(el){
  const hotspot=el.closest(hotspotSelector);
  const action=hotspot&&root.contains(hotspot)&&prototypeAction(hotspot);
  if(action&&!hotspot.closest(':disabled,[aria-disabled="true"],[inert]'))send({type:'prototypeAction',action,stamp});
}
document.addEventListener('keydown',event=>{
  if(!playback||!playing)return;
  const el=event.target;
  if(!(el instanceof Element))return;
  if(event.key==='Escape'){event.preventDefault();send({type:'prototypeEscape',stamp});return}
  if((event.key==='Enter'||event.key===' ')&&el.matches(hotspotSelector)&&!el.matches('button')){
    event.preventDefault();if(!event.repeat)triggerPrototype(el);
  }
});
`;

export const PROTOTYPE_BRIDGE_CSS = `
#root[data-prototype-player] [${DESIGN_PROTOTYPE_ATTRIBUTE}]{cursor:pointer}
#root[data-prototype-player][data-prototype-hints] [${DESIGN_PROTOTYPE_ATTRIBUTE}],
#root[data-prototype-player] [${DESIGN_PROTOTYPE_ATTRIBUTE}]:focus-visible{
  outline:2px solid #475569 !important;outline-offset:-2px !important;
  box-shadow:inset 0 0 0 4px #fff9 !important;
}
`;
