import { useRealCommunity } from '../src/context/RealCommunityContext';
const self={id:'00000000-0000-4000-8000-000000009999',name:'Synthetic Viewer',avatarInitials:'SV',avatarColor:'#285c45',verification:{verifiedGolfer:false}};
const friend={...self,id:'00000000-0000-4000-8000-000000008888',name:'Followed Golfer'};
export function useAuth(){return {isDemo:false,authUser:{id:self.id}};}
export function useData(){
 const c=useRealCommunity();(window as any).__community=c;
 return {...c,currentUser:self,golfCalls:[],caddieAnalyses:[],followingGolfers:[friend],
 visiblePosts:()=>c.posts.filter(p=>!c.isPostHidden(p.id)&&p.authorId!=='00000000-0000-4000-8000-000000007777'),
 getGolfer:(id:string)=>id===self.id?self:c.profilesById.get(id),getGolfCall:()=>null,hasPlayedWith:()=>false,isInCircle:()=>false,isBlocked:()=>false,isBlockedEitherWay:()=>false,
 };
}
export function useModeration(){return {available:false,isAdmin:false};}
export function useTutorial(){return {start:()=>{}};}
export function useTutorialEligibility(){return {eligible:false};}
export function useFirstRoundPrompt(){return {showReminderCard:false,startHosting:()=>{}};}
export function useFollowingFeed(){return {mode:'local',rows:[],media:[],hasMore:false,loading:false,loadMore:()=>{}};}
