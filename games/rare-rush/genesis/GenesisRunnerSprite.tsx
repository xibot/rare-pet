import { DEFAULT_BODY_ID, getGenesisBodyFrame } from './bodies';

export type GenesisRunnerSpriteProps = {
  /** Canonical portrait already validated by the Genesis identity reader. */
  portraitUrl: string;
  bodyId?: string;
  frame?: number;
  walking?: boolean;
};

/** SVG children in a 16×16 space. The game's parent handles slide/growth transforms. */
export function GenesisRunnerSprite({ portraitUrl, bodyId = DEFAULT_BODY_ID, frame = 0, walking = false }: GenesisRunnerSpriteProps) {
  const sprite = getGenesisBodyFrame(bodyId, frame, walking);
  return <g data-genesis-body={sprite.bodyId} shapeRendering="crispEdges" transform={sprite.transform}>
    <path data-genesis-body-outline="true" d={sprite.outlinePath} fill="#fff"/>
    <path data-genesis-body-pixels="true" d={sprite.bodyPath} fill="#000"/>
    <rect x={sprite.head.x - 1} y={sprite.head.y - 1} width="10" height="10" fill="#fff"/>
    <image data-genesis-art="true" href={portraitUrl} x={sprite.head.x} y={sprite.head.y} width={sprite.head.size} height={sprite.head.size}
      preserveAspectRatio="xMidYMid meet" style={{ imageRendering: 'pixelated' }}/>
  </g>;
}
