import { FriendSprite } from '../rare-rush/RunnerArt';
import { GenesisRunnerSprite } from '../rare-rush/genesis/GenesisRunnerSprite';
import { pickGenesisBody, previewFriends, type PreviewFriend } from './art';

export type SpacePassenger = Readonly<{ friend: PreviewFriend; bodyId?: string }>;

/** Cosmetic visitors use the bundled public art and change between flybys. */
export function pickSpacePassenger(previous?: SpacePassenger): SpacePassenger {
  const candidates = previewFriends.filter(friend =>
    friend.collection !== previous?.friend.collection || friend.tokenId !== previous.friend.tokenId);
  const available = candidates.length ? candidates : previewFriends;
  const friend = available[Math.floor(Math.random() * available.length)];
  return {
    friend,
    bodyId: friend.collection === 'genesis' ? pickGenesisBody(previous?.bodyId) : undefined,
  };
}

export function SpaceRider({ passenger, direction }: {
  passenger: SpacePassenger; direction: 'left' | 'right';
}) {
  const { friend, bodyId } = passenger;
  return <svg className="space-passenger" viewBox="-1 -1 18 18" aria-hidden="true" focusable="false"
    data-space-friend={`${friend.collection}:${friend.tokenId}`} shapeRendering="crispEdges">
    <g transform={direction === 'left' ? 'translate(16 0) scale(-1 1)' : undefined}>
      {friend.collection === 'genesis'
        ? <GenesisRunnerSprite portraitUrl={friend.image} bodyId={bodyId}/>
        : <FriendSprite sprites={friend.sprites} frame={0}/>}
    </g>
  </svg>;
}
