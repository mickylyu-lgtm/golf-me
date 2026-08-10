import type { CommentVote, CommunityPost, PostComment, PostVote } from "../types";
import { generateId } from "../lib/id";

function isoDaysAgo(days: number, hour = 12, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// A small hand-drawn placeholder meme image — brand-colored, no external
// image fetch, consistent with the rest of the prototype's local-only
// asset handling (same idea as GolferProfile.photoUrl data-URLs).
const MEME_IMAGE = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#dcece0"/>
  <circle cx="140" cy="150" r="70" fill="#f8faf8" stroke="#8bc09a" stroke-width="4"/>
  <circle cx="118" cy="128" r="4" fill="#b8d9c1"/>
  <circle cx="150" cy="120" r="4" fill="#b8d9c1"/>
  <circle cx="165" cy="150" r="4" fill="#b8d9c1"/>
  <circle cx="130" cy="165" r="4" fill="#b8d9c1"/>
  <circle cx="290" cy="150" r="55" fill="#ffffff" stroke="#26663d" stroke-width="6"/>
  <line x1="290" y1="150" x2="290" y2="112" stroke="#1e5232" stroke-width="5" stroke-linecap="round"/>
  <line x1="290" y1="150" x2="318" y2="150" stroke="#e59d14" stroke-width="5" stroke-linecap="round"/>
  <circle cx="290" cy="150" r="5" fill="#1e5232"/>
</svg>`);

export interface CommunitySeedBundle {
  posts: CommunityPost[];
  comments: PostComment[];
  postVotes: PostVote[];
  commentVotes: CommentVote[];
}

export function buildCommunityBundle(): CommunitySeedBundle {
  const posts: CommunityPost[] = [
    {
      id: "post-1",
      authorId: "g11", // Ethan Park
      type: "photo",
      text: "When the starter says you're already 10 minutes behind.",
      imageUrl: MEME_IMAGE,
      category: "Memes",
      createdAt: isoDaysAgo(0, 9),
    },
    {
      id: "post-2",
      authorId: "g1", // Jordan
      type: "course",
      text: "Played Bethpage Red yesterday. Greens were insanely fast — two-putted from 8 feet three times.",
      courseTag: "Bethpage Red",
      category: "Course Talk",
      createdAt: isoDaysAgo(1, 14),
    },
    {
      id: "post-3",
      authorId: "g12", // Maya
      type: "text",
      text: "Anyone switched to a mallet putter recently? Thinking about making the change but nervous about the learning curve.",
      category: "Equipment",
      createdAt: isoDaysAgo(2, 18),
    },
    {
      id: "post-4",
      authorId: "g9", // Lauren
      type: "round",
      text: "Great round with these guys today — pace was perfect and everyone was easy to play with.",
      golfCallId: "call-c2",
      category: "Round Stories",
      createdAt: isoDaysAgo(30, 13),
    },
    {
      id: "post-5",
      authorId: "g10", // Tyler
      type: "round",
      text: "Anyone free Saturday morning? Got a spot open at Bethpage Red, easy pace, all levels welcome.",
      golfCallId: "call-1",
      category: "Looking to Play",
      createdAt: isoDaysAgo(0, 8),
    },
    {
      id: "post-6",
      authorId: "g2", // Casey
      type: "text",
      text: "What's everyone's favorite public course around NYC? Still working through the list as a newer golfer.",
      category: "General",
      createdAt: isoDaysAgo(3, 11),
    },
  ];

  const comments: PostComment[] = [
    { id: "cmt-1", postId: "post-1", authorId: "g1", text: "This is way too accurate 😂", createdAt: isoDaysAgo(0, 9, 20) },
    { id: "cmt-2", postId: "post-1", authorId: "g9", text: "Every single time.", parentCommentId: "cmt-1", createdAt: isoDaysAgo(0, 9, 45) },
    {
      id: "cmt-3",
      postId: "post-2",
      authorId: "g3",
      text: "Bethpage Red is underrated — agreed on the greens, they roll true all day.",
      createdAt: isoDaysAgo(1, 15),
    },
    { id: "cmt-4", postId: "post-5", authorId: "g2", text: "See you there — I'm already in!", createdAt: isoDaysAgo(0, 8, 30) },
  ];

  const postVotes: PostVote[] = [
    { id: generateId("pv"), postId: "post-1", voterId: "g1", createdAt: isoDaysAgo(0, 9, 5) },
    { id: generateId("pv"), postId: "post-1", voterId: "g3", createdAt: isoDaysAgo(0, 9, 10) },
    { id: generateId("pv"), postId: "post-1", voterId: "g9", createdAt: isoDaysAgo(0, 9, 15) },
    { id: generateId("pv"), postId: "post-2", voterId: "g7", createdAt: isoDaysAgo(1, 14, 30) },
    { id: generateId("pv"), postId: "post-2", voterId: "g11", createdAt: isoDaysAgo(1, 15) },
    { id: generateId("pv"), postId: "post-4", voterId: "g1", createdAt: isoDaysAgo(29, 20) },
  ];

  const commentVotes: CommentVote[] = [{ id: generateId("cv"), commentId: "cmt-1", voterId: "g3", createdAt: isoDaysAgo(0, 9, 25) }];

  return { posts, comments, postVotes, commentVotes };
}
