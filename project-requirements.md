# Internet Technologies: Become a Full-Stack Engineer

**RUNI CS 2026**

> **Note:** This year, we expanded our stack beyond software engineering alone to encompass the entire product and its business implications. The exercise allows and encourages the use of coding agents.

---

## **Final Project: Building a Web Product with Business Value**

### **Project Goal**

In this final project, you will plan, specify, implement, and present a complete, end-to-end software product.

The goal is not just to write code, but to think like a real product team: identify a business need, design a technological solution, build it, test it, deploy it to the cloud, and deeply understand every technical decision you made.

- **Final Submission Deadline:** September 6, 2026

---

## **Project Stages**

### **1. Product Selection**

Choose a product that can be implemented as a Web application and carries real-world business significance.
The product should address a clear need, for example:

- Saving time
- Enabling the sale of products/services
- Improving a business process
- Helping users make better decisions
- Enabling an organization to operate more efficiently

### **2. Product Specification Document (PRD)**

Write a specification document that explains the product at both business and product levels.
The document should include:

- What problem the product solves
- Who the target users are
- Who the customer is
- What the business goals of the product are
- What software capabilities need to be built to support these business goals
- What key processes the product enables users to perform  
  _For example:_
  - Registration and Authentication (Sign up / Sign in)
  - Project creation
  - Data upload
  - Customer management
  - Receiving recommendations
  - Processing payments
  - Report generation
  - Data sharing with other users

### **3. Software Architecture Design**

Design the system architecture from a technical perspective. You need to explain:

- What components will compose the system
- Whether you will use a database
- What key tables or entities will exist in the database
- What pages will be in the application
- What API routes or Server Actions you will need
- How data will flow between the Frontend, Backend, and Database
- What user types and permissions will exist in the system
- What external libraries or services you will integrate, and why

### **4. Detailed Technical Specification**

Before implementation, write a detailed technical design document. The document should include:

- Project directory structure
- Key component architecture
- Database schema
- Core CREATE/READ/UPDATE/DELETE (CRUD) operations
- API documentation/description
- Core business logic description
- State Management strategy
- Error Handling
- Input Validations
- Core User Experience (UX) design

_The goal is to ensure you know what you are building before you start writing code._

### **5. Product Implementation**

Implement the product using:

- **Next.js**
- **TypeScript**
- **Supabase** for Database and optionally Authentication
- **Vercel** for Deployment

_The product must be accessible via a public URL, not just running locally on your machine._

### **6. Test Plan Document**

Write a document explaining what tests need to be executed to ensure the product functions properly. The document should include:

- Testing core features
- Testing invalid inputs
- Testing key business workflows
- Testing authorization/permissions (if multiple user roles exist)
- Testing the database layer
- Edge-case testing
- Basic UI testing

_The goal is to demonstrate that you can define what it means for a product to "work."_

### **7. Test Implementation**

Implement the tests you designed. You can use tools such as:

- Vitest
- Jest
- React Testing Library
- Playwright
- Documented manual testing where appropriate

_You don't need 100% code coverage, but key product workflows must be tested._

### **8. Basic Scalability**

Write a document explaining how your product supports basic scalability. The document should address topics such as:

- What happens when scaling to tens or hundreds of users
- Which database queries might become heavy bottlenecks
- Whether database indexing is required
- How to prevent unnecessary data fetching
- Proper implementation of pagination
- Proper Separation of Concerns between client-side and server-side
- Existing architectural limitations in the current version
- What improvements you would make in future versions to support larger scale

### **9. Basic Security**

Write a document explaining the steps taken to secure the product at a baseline level. The document should include:

- How Authentication is handled
- How Authorization is enforced
- Which actions are restricted to authenticated users only
- How you prevent unauthorized access to another user's data (Data Isolation)
- How input validation is performed
- How API endpoints are protected
- How secrets (e.g., API keys) are managed safely
- What security risks remain and what you would improve moving forward

### **10. Deployment & Release**

You must deploy the product live using:

- **Vercel** for hosting the application
- **Supabase** for hosting the database

Your submission must include:

- A link to the live production application
- A link to the GitHub repository
- Local setup & execution instructions
- A brief explanation of required Environment Variables

### **11. Optional Use of Coding Agents**

You are allowed—and encouraged—to use coding agents or AI tools to accelerate development, such as:

- Architecture planning
- Component generation
- Writing test suites
- Improving UI
- Debugging
- Generating documentation

_However, full accountability for the code remains yours._ By the end of the project, you must review all code, understand it thoroughly, and be able to justify why every library, component, pattern, and technical decision was chosen.

A recommended practice is to ask your coding agent to generate an internal document or wiki explaining the technical layout of the system: architecture, key files, core logic flows, database schema, tests, and technical choices.

### **12. Presentation Preparation**

At the conclusion of the project, you will present your product in a **10–15 minute presentation**.

In the presentation, you must explain:

- What the product is
- What problem it solves
- Who the target users are
- Why it holds business value
- How the system is architected
- What the system architecture looks like
- What the database schema looks like
- What the core workflows are
- What tests were implemented
- How you designed for scalability
- How you designed for security
- What you would improve given more time

**Crucial:** You must know your product **inside and out**. It is not enough for the app to function — you must explain _how_ and _why_ it functions. Treat this as a brief technical job interview on work you delivered.

---

## **Submission Deliverables**

1. Link to the deployed Vercel application
2. Link to the GitHub repository
3. Product Specification Document (PRD)
4. Technical Design Document
5. Test Plan Document
6. Test code codebase
7. Basic Scalability Document
8. Basic Security Document
9. Local setup & execution instructions
10. A short slide deck for the 10–15 minute presentation

---

## **Important Guidelines**

The project is evaluated not just by the sheer volume of features, but by the quality of engineering thought. It is far better to build a small, clear, functional, secure, and well-architected product than a large, messy, and unstable one.

We expect to see:

- Product-oriented thinking
- Structured technical planning
- Clean Code
- Proper Database interactions
- Meaningful tests
- Understanding of core security principles
- Understanding of basic system scalability
- Ability to explain the system in depth
