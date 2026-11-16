import { useState, useCallback } from "react";
// Synthetic data only; real Home and PostCard components render these records.
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'mixed';
const golfer = { id: 'friend', name: 'Followed Golfer', areaLabel: 'Test town', avatarColor: '#285c45', avatarInitials: 'FG', verification: { verifiedGolfer: false } };
const stranger = {...golfer, id:'stranger',name:'Community Golfer',avatarInitials:'CG'};
const posts = ['empty','loading','error'].includes(scenario) ? [] : Array.from({length:scenario === 'large' ? 120 : 10},(_,i) => ({
 id:'post-'+i,authorId:i === 1 ? 'friend' : 'stranger',type:'text',category:'general',
 text:i === 0 ? 'Newest community post — from a golfer you do not follow. Anyone up for practice this weekend?' : i === 1 ? 'Older followed post — great morning on the course.' : 'Community practice update '+i+'. Sharing progress with everyone.',
 createdAt:new Date(Date.now()-i*3600000).toISOString()
}));
const data = {
 currentUser:{...golfer,id:'self',name:'Demo Viewer'}, golfCalls:[],caddieAnalyses:[],followingGolfers:scenario === 'zero' ? [] : [golfer],
 visiblePosts:()=>posts,getGolfer:(id:string)=>id === 'stranger' ? stranger : golfer,
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
