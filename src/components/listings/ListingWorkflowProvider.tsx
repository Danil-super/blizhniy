"use client";
import {createContext,useContext,type ReactNode} from 'react';
const Context=createContext(false);
export function ListingWorkflowProvider({postmoderation,children}:{postmoderation:boolean;children:ReactNode}){return <Context.Provider value={postmoderation}>{children}</Context.Provider>;}
export function useListingPostmoderation(){return useContext(Context);}
