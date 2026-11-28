import type {ReactNode} from 'react';
import {SimulatorApiContext,type SimulatorApi} from './simulatorApiContext';
export function SimulatorApiProvider({api,children}:{api:SimulatorApi;children:ReactNode}){return <SimulatorApiContext.Provider value={api}>{children}</SimulatorApiContext.Provider>}
