import { useId } from 'react';

export type ClassicIsland = 'meadow' | 'moon' | 'arcade' | 'beach' | 'rare';

const surface = 'M72 16H248V22H272V28H288V36H304V54H288V62H272V68H248V74H72V68H48V62H32V54H16V36H32V28H48V22H72Z';
const rim = 'M16 46H304V64H288V72H272V78H248V84H72V78H48V72H32V64H16Z';
const underside = 'M32 56H288V70H272V80H248V88H224V94H96V88H72V80H48V70H32Z';
const palettes = {
  meadow: { top: '#b7e95c', rim: '#6e963a', earth: '#92704e', bottom: '#544735' },
  moon: { top: '#d2c6ef', rim: '#9c85c5', earth: '#7c6898', bottom: '#514260' },
  arcade: { top: '#d6ff43', rim: '#93b818', earth: '#383c34', bottom: '#191c18' },
  beach: { top: '#f7e0a2', rim: '#ddba66', earth: '#ba8d50', bottom: '#785e40' },
  rare: { top: '#fff', rim: '#000', earth: '#fff', bottom: '#000' },
} as const;

/** Original RarePet island artwork, preserved for the shared island catalogue. */
export function ClassicIslandArt({ island }: { island: ClassicIsland }) {
  const clipId = `island-${useId().replace(/:/g, '')}`;
  const color = palettes[island];
  return <svg viewBox="0 0 320 104" shapeRendering="crispEdges" aria-hidden="true" focusable="false" data-classic-island={island}>
    <defs><clipPath id={clipId}><path d={surface}/></clipPath></defs>
    <path d="M80 96H240V100H80Z" fill={island === 'rare' ? '#000' : '#18201a'} opacity=".1"/>
    <path d={underside} fill={color.bottom}/><path d="M40 54H280V68H264V78H240V86H216V90H104V86H80V78H56V68H40Z" fill={color.earth}/>
    <path d="M72 72H82V81H72ZM116 83H128V90H116ZM220 71H228V81H220ZM257 62H266V71H257Z" fill={color.bottom} opacity=".6"/>
    <path d={rim} fill={color.rim}/><path d={surface} fill={color.top}/>
    {island === 'rare' && <path d={surface} fill="none" stroke="#000" strokeWidth="2"/>}
    <g clipPath={`url(#${clipId})`}>
      {island === 'rare' && <>
        <path d="M72 16H88V22H104V28H88V22H72ZM120 16H136V22H152V28H136V22H120ZM168 16H184V22H200V28H184V22H168ZM216 16H232V22H248V28H232V22H216Z" fill="#000"/>
        <path d="M48 58H64V64H80V70H64V64H48ZM96 64H112V70H128V76H112V70H96ZM144 64H160V70H176V76H160V70H144ZM192 64H208V70H224V76H208V70H192ZM240 58H256V64H272V70H256V64H240Z" fill="#000"/>
        <path d="M62 33H66V39H72V43H66V49H62V43H56V39H62ZM254 33H258V39H264V43H258V49H254V43H248V39H254Z" fill="#000"/>
        <path d="M93 38H97V42H93ZM223 49H227V53H223ZM38 45H42V49H38ZM278 35H282V39H278Z" fill="#000"/>
      </>}
      {island === 'meadow' && <>
        <path d="M16 37H50V42H70V47H31V55H17ZM236 16H247V27H274V35H249V31H232ZM71 60H87V65H116V74H71ZM224 55H244V62H268V69H224Z" fill="#9acd47"/>
        <path d="M50 29H58V32H50ZM82 22H88V25H82ZM250 43H258V46H250ZM218 64H224V67H218Z" fill="#e1f6a2"/>
        <path d="M60 43V36H63V42H66V39H69V46H60ZM239 33V26H242V32H245V29H248V36H239ZM214 68V61H217V67H220V64H223V71H214Z" fill="#628d33"/>
        <path d="M86 47H90V53H86ZM263 52H267V58H263Z" fill="#728636"/><path d="M82 42H94V46H82ZM259 47H271V51H259Z" fill="#fff6d9"/><path d="M86 38H90V50H86ZM263 43H267V55H263Z" fill="#fff6d9"/><path d="M86 42H90V46H86ZM263 47H267V51H263Z" fill="#edb54b"/>
      </>}
      {island === 'moon' && <>
        <path d="M51 29H78V34H83V43H77V47H53V42H47V34H51ZM230 47H256V52H262V60H256V64H230V59H224V52H230ZM198 19H212V23H218V30H198V26H193V23H198Z" fill="#ac98cd"/>
        <path d="M55 31H76V36H78V39H57V43H51V36H55ZM234 49H254V54H257V57H233V60H229V54H234Z" fill="#8f7cac"/>
        <path d="M78 56H86V60H92V67H78V63H73V60H78ZM268 35H275V42H268ZM103 20H109V24H103ZM198 67H204V70H198Z" fill="#ece5fa"/>
        <path d="M66 57H70V61H66ZM223 31H228V35H223ZM97 66H101V70H97Z" fill="#a998c2"/>
      </>}
      {island === 'arcade' && <>
        <path d="M0 20H320M0 38H320M0 56H320M0 74H320M16 0V90M52 0V90M88 0V90M124 0V90M160 0V90M196 0V90M232 0V90M268 0V90M304 0V90" stroke="#b0d929" strokeWidth="1"/>
        <path d="M16 38H52V56H16ZM52 20H88V38H52ZM88 56H124V74H88ZM232 20H268V38H232ZM268 38H304V56H268ZM196 56H232V74H196Z" fill="#c0ea36"/>
        <path d="M42 37H60V41H66V45H60V49H42V45H49V41H42ZM252 37H270V41H263V45H270V49H252V45H246V41H252Z" fill="#323c1b"/>
        <path d="M118 21H202V24H118Z" fill="#f0ffc3"/>
      </>}
      {island === 'beach' && <>
        <path d="M0 14H104V20H83V26H61V32H43V42H34V53H23V72H0Z" fill="#75d5e6"/>
        <path d="M0 14H89V19H69V24H48V31H29V40H17V54H0Z" fill="#42b6d2"/>
        <path d="M103 14H111V20H87V26H65V32H47V42H38V53H27V72H23V50H33V38H42V28H61V22H83V16H103Z" fill="#f4ffff"/>
        <path d="M6 28H29V31H6ZM18 42H28V45H18ZM49 21H65V24H49Z" fill="#c1f1f3"/>
        <path d="M237 31H241V36H248V40H242V47H238V41H231V37H237Z" fill="#e39173"/>
        <path d="M258 52H265V56H268V60H255V56H258Z" fill="#fff9dc"/><path d="M260 54H263V60H260Z" fill="#d5b36e"/>
        <path d="M80 49H86V52H80ZM103 65H109V68H103ZM272 41H277V44H272ZM220 64H227V67H220Z" fill="#d6b570"/>
      </>}
    </g>
    {island === 'meadow' && <g><path d="M48 35V25H52V35Z" fill="#fff6d9"/><path d="M42 23H58V27H42ZM46 19H54V23H46Z" fill="#dc8269"/><path d="M46 22H49V25H46Z" fill="#fff6d9"/></g>}
    {island === 'moon' && <g fill="#b8a6e9"><path d="M46 3H49V7H53V10H49V14H46V10H42V7H46ZM273 11H276V15H280V18H276V22H273V18H269V15H273Z"/></g>}
    {island === 'arcade' && <g><path d="M53 74H81V77H53ZM239 74H267V77H239Z" fill="#ccff00"/></g>}
    {island === 'rare' && <path d="M58 73H74V76H58ZM91 81H107V84H91ZM133 85H153V88H133ZM181 85H197V88H181ZM223 81H239V84H223ZM250 72H266V75H250Z" fill="#fff"/>}
  </svg>;
}
