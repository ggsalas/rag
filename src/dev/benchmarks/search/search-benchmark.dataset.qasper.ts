import type { GradedBenchmarkCase } from './search-benchmark.types'

/**
 * QASPER benchmark dataset — fragment-based graded evaluation on academic papers.
 *
 * Two papers from the QASPER dataset (Dasigi et al. 2021, CC BY 4.0) loaded into
 * a single library to test multi-document retrieval with cross-document distractors.
 *
 * Ground truth from QASPER annotator `highlighted_evidence`. FLOAT SELECTED
 * references (table/figure pointers) discarded; section-path prefixes stripped;
 * duplicates across annotators removed.
 *
 * Relevance grade 2 = fragment directly answers the query.
 */

export const QASPER_POSITIVE_CASES: GradedBenchmarkCase[] = [
  {
    id: '1910.11471-q0',
    query: `What additional techniques are incorporated?`,
    fragments: [
      { text: `Although the generated code is incoherent and often predict wrong code token, this is expected because of the limited amount of training data. LSTM generally requires a more extensive set of data (100k+ in such scenario) to build a more accurate model. The incoherence can be resolved by incorporating coding syntax tree model in future. For instance–

"define the method tzname with 2 arguments: self and dt."

is translated into–

def __init__ ( self , regex ) :.

The translator is successfully generating the whole codeline automatically but missing the noun part (parameter and function name) part of the syntax.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1910.11471-q1',
    query: `What dataset do they use?`,
    fragments: [
      { text: `SMT techniques require a parallel corpus in thr source and thr target language. A text-code parallel corpus similar to Fig. FIGREF12 is used in training. This parallel corpus has 18805 aligned data in it . In source data, the expression of each line code is written in the English language. In target data, the code is written in Python programming language.`, grade: 2 },
      { text: `A text-code parallel corpus similar to Fig. FIGREF12 is used in training. This parallel corpus has 18805 aligned data in it .`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1910.11471-q3',
    query: `What is the architecture of the system?`,
    fragments: [
      { text: `For training, three types of Recurrent Neural Network (RNN) layers are used – an encoder layer, a decoder layer and an output layer. These layers together form a LSTM model. LSTM is typically used in seq2seq translation.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1910.11471-q5',
    query: `What additional techniques could be incorporated to further improve accuracy?`,
    fragments: [
      { text: `In later phase, phrase-based word embedding can be incorporated for improved vocabulary mapping. To get more accurate target code for each line, Abstract Syntax Tree(AST) can be beneficial.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1910.11471-q6',
    query: `What programming language is target language?`,
    fragments: [
      { text: `In target data, the code is written in Python programming language.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1910.11471-q7',
    query: `What dataset is used to measure accuracy?`,
    fragments: [
      { text: `During the final training process, 500 validation data is used to generate the recurrent neural model, which is 3% of the training data.`, grade: 2 },
      { text: `After finishing the training, the accuracy of the generated model using validation data from the source corpus was 74.40%`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q0',
    query: `What data is the language model pretrained on?`,
    fragments: [
      { text: `Due to the high cost of pre-training BERT language model, we directly adopt parameters pre-trained by Google in Chinese general corpus. The named entity recognition is applied on both pathology report texts and query texts.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q1',
    query: `What baselines is the proposed model compared against?`,
    fragments: [
      { text: `Since BERT has already achieved the state-of-the-art performance of question-answering, in this section we compare our proposed model with state-of-the-art question answering models (i.e. QANet BIBREF39) and BERT-Base BIBREF26. As BERT has two versions: BERT-Base and BERT-Large, due to the lack of computational resource, we can only compare with BERT-Base model instead of BERT-Large.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q2',
    query: `How is the clinical text structuring task defined?`,
    fragments: [
      { text: `Clinical text structuring (CTS) is a critical task for fetching medical research data from electronic health records (EHRs), where structural patient medical data, such as whether the patient has specific symptoms, diseases, or what the tumor size is, how far from the tumor is cut at during the surgery, or what the specific laboratory test result is, are obtained. It is important to extract structured data from clinical text because bio-medical systems or bio-medical researches greatly rely on structured data but they cannot obtain them directly. In addition, clinical text often contains abundant healthcare information. CTS is able to provide large-scale extracted structured data for enormous down-stream clinical researches.`, grade: 2 },
      { text: `Unlike the traditional CTS task, our QA-CTS task aims to discover the most related text from original paragraph text. For some cases, it is already the final answer in deed (e.g., extracting sub-string). While for other cases, it needs several steps to obtain the final answer, such as entity names conversion and negative words recognition. Our presented QA-CTS task unifies the output format of the traditional CTS task and make the training data shareable, thus enriching the training data.`, grade: 2 },
      { text: `Clinical text structuring (CTS) is a critical task for fetching medical research data from electronic health records (EHRs), where structural patient medical data, such as whether the patient has specific symptoms, diseases, or what the tumor size is, how far from the tumor is cut at during the surgery, or what the specific laboratory test result is, are obtained. It is important to extract structured data from clinical text because bio-medical systems or bio-medical researches greatly rely on structured data but they cannot obtain them directly.`, grade: 2 },
      { text: `However, end-to-end CTS is a very challenging task. Different CTS tasks often have non-uniform output formats, such as specific-class classifications (e.g. tumor stage), strings in the original text (e.g. result for a laboratory test) and inferred values from part of the original text (e.g. calculated tumor size).`, grade: 2 },
      { text: `To reduce the pipeline depth and break the barrier of non-uniform output formats, we present a question answering based clinical text structuring (QA-CTS) task (see Fig. FIGREF1). Unlike the traditional CTS task, our QA-CTS task aims to discover the most related text from original paragraph text.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q3',
    query: `What are the specific tasks being unified?`,
    fragments: [
      { text: `Our presented QA-CTS task unifies the output format of the traditional CTS task and make the training data shareable, thus enriching the training data.`, grade: 2 },
      { text: `All question-answer pairs are annotated and reviewed by four clinicians with three types of questions, namely tumor size, proximal resection margin and distal resection margin.`, grade: 2 },
      { text: `Experimental results on real-world dataset demonstrate that our proposed model competes favorably with strong baseline models in all three specific tasks.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q4',
    query: `Is all text in this dataset a question, or are there unrelated sentences in between questions?`,
    fragments: [
      { text: `Our dataset is annotated based on Chinese pathology reports provided by the Department of Gastrointestinal Surgery, Ruijin Hospital. It contains 17,833 sentences, 826,987 characters and 2,714 question-answer pairs. All question-answer pairs are annotated and reviewed by four clinicians with three types of questions, namely tumor size, proximal resection margin and distal resection margin.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q5',
    query: `How many questions are in the dataset?`,
    fragments: [
      { text: `Our dataset is annotated based on Chinese pathology reports provided by the Department of Gastrointestinal Surgery, Ruijin Hospital. It contains 17,833 sentences, 826,987 characters and 2,714 question-answer pairs.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q8',
    query: `How they introduce domain-specific features into pre-trained language model?`,
    fragments: [
      { text: `We also propose an effective model to integrate clinical named entity information into pre-trained language model.`, grade: 2 },
      { text: `In this section, we present an effective model for the question answering based clinical text structuring (QA-CTS). As shown in Fig. FIGREF8, paragraph text $X$ is first passed to a clinical named entity recognition (CNER) model BIBREF12 to capture named entity information and obtain one-hot CNER output tagging sequence for query text $I_{nq}$ and paragraph text $I_{nt}$ with BIEOS (Begin, Inside, End, Outside, Single) tag scheme. $I_{nq}$ and $I_{nt}$ are then integrated together into $I_n$. Meanwhile, the paragraph text $X$ and query text $Q$ are organized and passed to contextualized representation model which is pre-trained language model BERT BIBREF26 here to obtain the contextualized representation vector $V_s$ of both text and query. Afterwards, $V_s$ and $I_n$ are integrated together and fed into a feed forward network to calculate the start and end index of answer-related text.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q9',
    query: `How big is QA-CTS task dataset?`,
    fragments: [
      { text: `Our dataset is annotated based on Chinese pathology reports provided by the Department of Gastrointestinal Surgery, Ruijin Hospital. It contains 17,833 sentences, 826,987 characters and 2,714 question-answer pairs.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q10',
    query: `How big is dataset of pathology reports collected from Ruijing Hospital?`,
    fragments: [
      { text: `Our dataset is annotated based on Chinese pathology reports provided by the Department of Gastrointestinal Surgery, Ruijin Hospital. It contains 17,833 sentences, 826,987 characters and 2,714 question-answer pairs.`, grade: 2 },
    ],
    kind: 'positive',
  },
  {
    id: '1908.06606-q11',
    query: `What are strong baseline models in specific tasks?`,
    fragments: [
      { text: `Since BERT has already achieved the state-of-the-art performance of question-answering, in this section we compare our proposed model with state-of-the-art question answering models (i.e. QANet BIBREF39) and BERT-Base BIBREF26. As BERT has two versions: BERT-Base and BERT-Large, due to the lack of computational resource, we can only compare with BERT-Base model instead of BERT-Large.`, grade: 2 },
    ],
    kind: 'positive',
  },
]

/**
 * Cases where all QASPER annotators marked the question as unanswerable.
 * Excluded from Hit/nDCG/Recall metrics (no relevant chunks exist).
 */
export const QASPER_UNANSWERABLE_CASES: GradedBenchmarkCase[] = [
  {
    id: '1910.11471-q4',
    query: `How long are expressions in layman's language?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: '1908.06606-q6',
    query: `What is the perWhat are the tasks evaluated?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: '1908.06606-q7',
    query: `Are there privacy concerns with clinical data?`,
    fragments: [],
    kind: 'negative',
  },
]

/** Combined QASPER dataset (positives + unanswerable) */
export const QASPER_BENCHMARK: GradedBenchmarkCase[] = [
  ...QASPER_POSITIVE_CASES,
  ...QASPER_UNANSWERABLE_CASES,
]

/**
 * Cross-library negative cases: questions from paper A whose evidence exists
 * only in paper A. When evaluated against a library containing only paper B,
 * these are realistic negatives — well-formed questions with no answer in the corpus.
 *
 * These are SEPARATE from unanswerable cases (where annotators explicitly marked
 * the question as unanswerable). Cross-negatives test retrieval precision in
 * multi-document settings.
 */
export const QASPER_CROSS_NEGATIVE_CASES: GradedBenchmarkCase[] = [
  {
    id: 'cross-1910.11471-q0',
    query: `What additional techniques are incorporated?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1910.11471-q1',
    query: `What dataset do they use?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1910.11471-q3',
    query: `What is the architecture of the system?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1910.11471-q5',
    query: `What additional techniques could be incorporated to further improve accuracy?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1910.11471-q6',
    query: `What programming language is target language?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1910.11471-q7',
    query: `What dataset is used to measure accuracy?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q0',
    query: `What data is the language model pretrained on?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q1',
    query: `What baselines is the proposed model compared against?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q2',
    query: `How is the clinical text structuring task defined?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q3',
    query: `What are the specific tasks being unified?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q4',
    query: `Is all text in this dataset a question, or are there unrelated sentences in between questions?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q5',
    query: `How many questions are in the dataset?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q8',
    query: `How they introduce domain-specific features into pre-trained language model?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q9',
    query: `How big is QA-CTS task dataset?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q10',
    query: `How big is dataset of pathology reports collected from Ruijing Hospital?`,
    fragments: [],
    kind: 'negative',
  },
  {
    id: 'cross-1908.06606-q11',
    query: `What are strong baseline models in specific tasks?`,
    fragments: [],
    kind: 'negative',
  },
]
