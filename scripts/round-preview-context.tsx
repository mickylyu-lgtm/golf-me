import { useState, useCallback } from "react";
// Synthetic data only; real Home and PostCard components render these records.
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'mixed';
const golfer = { id: 'friend', name: 'Jamie Lee', areaLabel: 'Test town', avatarColor: 'from-emerald-600 to-emerald-800', avatarInitials: 'JL', verification: { verifiedGolfer: false } };
const stranger = {...golfer, id:'stranger',name:'Alex Chen',avatarInitials:'AC'};
const posts = ['empty','loading','error'].includes(scenario) ? [] : Array.from({length:scenario === 'large' ? 120 : 10},(_,i) => ({
 id:'post-'+i,authorId:i === 1 ? 'friend' : 'stranger',type:'text',category:'general',
 text:i === 0 ? 'Newest community post — from a golfer you do not follow. Anyone up for practice this weekend?' : i === 1 ? 'Older followed post — great morning on the course.' : 'Community practice update '+i+'. Sharing progress with everyone.',
 createdAt:new Date(Date.now()-i*3600000).toISOString()
}));
const data = {
 currentUser:{...golfer,id:'self',name:'Micky Lyu'}, golfCalls: scenario === 'empty' ? [] : [{id:'preview-round',hostId:scenario === 'host' ? 'self' : 'friend',courseLat:scenario === 'aerial' ? 34.1246158 : undefined,courseLng:scenario === 'aerial' ? -118.2703437 : undefined,course:scenario === 'aerial' ? 'Los Feliz 3-Par Golf Course' : scenario === 'fallback' ? 'A Very Long Golf Course Name Without A Verified Photo' : 'Skyway Golf Course',areaLabel:scenario === 'aerial' ? 'Los Angeles, CA' : 'Jersey City, NJ',dateISO:'2026-12-12',timeLabel:'1:30 PM',estimatedPricePerPerson:49,totalSpots:4,joinedGolferIds:['friend','stranger'],pendingRequestIds:[],joinMode:'request',skillLevel:'Any Skill Level',vibe:'Casual',walkOrCart:'Either',holes:9,gameFormat:'Stroke Play',status:'open',createdAt:'2026-11-18T19:00:00Z',teeTimeSource:'unverified',bookingStatus:scenario === 'booked' ? 'booked' : 'unknown'}],caddieAnalyses:[],followingGolfers:[],
 visiblePosts:()=>posts,getGolfer:(id:string)=>scenario === 'missing' ? undefined : id === 'stranger' ? stranger : golfer,
 isBlockedEitherWay:(id:string)=>id === 'blocked',isPostHidden:(id:string)=>id === 'hidden-paged',getGolfCall:()=>null,isInCircle:()=>false,hasPlayedWith:()=>false,isPostUpvoted:()=>false,postUpvoteCount:()=>0,isPostSaved:()=>false,commentsForPost:()=>[],isBlocked:()=>false,
};
export function useData(){return data;}
export function useAuth(){return {isDemo:!['loading','error','empty','stale','server'].includes(scenario),authUser:{id:'self'}};}
export function useModeration(){return {available:false,isAdmin:false};}
export function useRealCommunity(){return {posts,hasMorePosts:false,isPaging:false,pageError:false,loadOlderPosts:async()=>{},hasLoaded:!['loading','error'].includes(scenario),isLoading:scenario === 'loading',loadError:scenario === 'error',refreshFailed:scenario === 'stale',retry:()=>{(window as any).__retried=true;}};}
export function useTutorial(){return {start:()=>{}};}
export function useTutorialEligibility(){return {eligible:false};}
export function useFirstRoundPrompt(){return {showReminderCard:false,startHosting:()=>{}};}

const pagedRows = ['First paged followed post','Second paged followed post','Hidden paged post','Removed paged post'].map((text,i)=>({id:i === 2 ? 'hidden-paged' : 'paged-'+i,author_id:'friend',type:'text',category:'general',text,created_at:new Date(Date.now()-(i === 3 ? 4 : 20+i)*3600000).toISOString(),swing_analysis_status:'not_applicable'}));
export function useFollowingFeed(){
 const [loaded,setLoaded] = useState(false);
 const loadMore = useCallback(()=>{(window as any).__serverPages = 1;setLoaded(true);},[]);
 return scenario === 'server' ? {mode:'server',rows:loaded ? pagedRows : [pagedRows[0],pagedRows[2],pagedRows[3]],media:[],hasMore:!loaded,loading:false,loadMore} : {mode:'local',rows:[],media:[],hasMore:false,loading:false,loadMore:()=>{}};
}
