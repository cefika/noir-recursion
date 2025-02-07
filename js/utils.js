import { createReadStream } from 'fs';
import { createReadableStreamFromReadable } from '@remix-run/node';
import { Noir } from '@noir-lang/noir_js'; 
import { compile, createFileManager } from '@noir-lang/noir_wasm';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

/**
 * Loading and compiling circuits
 * @param {} circuitName 
 * @returns 
 */
export const getCircuit = async (circuitName) => {
    const fm = createFileManager(path.join(__dirname, '..', circuitName, 'build'));
    const nr = createReadStream(`../${circuitName}/src/main.nr`, 'utf8');
    await fm.writeFile('./src/main.nr', createReadableStreamFromReadable(nr));
  
    const nargoToml = createReadStream(`../${circuitName}/Nargo.toml`, 'utf8');
    await fm.writeFile('./Nargo.toml', createReadableStreamFromReadable(nargoToml));
  
    const result = await compile(fm);
    if (!('program' in result)) {
      throw new Error('Compilation failed');
    }
  
    return result;
}

/**
 * Formatted log output
 * @param {} message 
 */
export const log = (message, logType='info') => {
    const time = new Date().toISOString().split('T')[1].split('.')[0];

    if (logType !== 'error') {
        console.log(`[${time}]:`, message)
    } else {
        console.error(`[${time}]:`, message)
    }
}

/**
 * Formatted error output
 * @param {} message 
 */
export const logError = (message) => {
    log(message, 'error')
}

const buildBackend = (compiledCircuit, recursive=false) => {
    const { program } = compiledCircuit;
    const noir = new Noir(program);

    const backend = new BarretenbergBackend(program, { threads: 8 }, { recursive });
    return { backend, noir };    
}

/**
 * Subroutine for generating backend and wittness
 * @param {*} compiledCircuit 
 * @param {*} inputs 
 * @returns 
 */
const buildBackendAndWitness = async (compiledCircuit, inputs, recursive = true) => {
    const { backend, noir } = buildBackend(compiledCircuit, recursive);

    const { witness } = await noir.execute(inputs);

    return { backend, witness };
}

const _generateProofAndArtifacts = async (backend, witness) => {
    const { publicInputs, proof } = await backend.generateProof(witness);
    const artifacts = await backend.generateRecursiveProofArtifacts({ proof, publicInputs }, publicInputs.length);

    return { publicInputs, proof, artifacts };
}

/**
 * Generate proof
 */
export const generateProof = async (compiledCircuit, inputs) => {
    const { backend, witness } = await buildBackendAndWitness(compiledCircuit, inputs);
    return _generateProofAndArtifacts(backend, witness);
}

export const generateRecursiveProof = async (compiledCircuit, proofPublicInputs, artifacts, inputs) => {
    const { vkAsFields, proofAsFields, vkHash } = artifacts;

    const recinputs = {
        ...inputs,
        verification_key: vkAsFields.map(e => e.toString()),
        proof: proofAsFields,
        public_inputs: proofPublicInputs,
        key_hash: vkHash,
    }

    return generateProof(compiledCircuit, recinputs, false);
}

export const verifyProof = async(compiledCircuit, proof, publicInputs) => {
    const { backend } = buildBackend(compiledCircuit, true);
    const res = await backend.verifyProof({ proof, publicInputs });
    return res;
}